import { z } from "zod";
import { homeFor, type Role } from "@/lib/auth/permissions";
import { ReviewError } from "@/lib/reviews/service";
import type { DeepService } from "./service";

export type Actor = { userId: string; roles: Role[] };
export type DeepDeps = {
  getActor(): Promise<Actor | null>;
  service: DeepService;
  flags: { deepReviewPurchase: boolean; enhancedIssuance: boolean };
  now?: () => Date;
};
type Params = Record<string, string>;
type Handler = (deps: DeepDeps, req: Request, params?: Params) => Promise<Response>;
type Scope = "owner" | "reviewer" | "coordinator";

const json = (body: unknown, status = 200) => Response.json(body, { status });
const notFound = () => json({ code: "NOT_FOUND" }, 404);
const invalid = () => json({ code: "INVALID_REQUEST" }, 400);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const readJson = (req: Request) => req.json().catch(() => null);

function allowed(scope: Scope, roles: Role[]): boolean {
  if (scope === "owner") return homeFor(roles) === "/dashboard";
  if (scope === "reviewer") return roles.includes("reviewer");
  return roles.includes("partner_admin") || roles.includes("platform_admin");
}

function mapError(e: unknown): Response {
  if (e instanceof ReviewError) {
    switch (e.code) {
      case "FORBIDDEN": case "NOT_FOUND": return notFound();
      case "REVIEWER_NOT_AUTHORIZED": return json({ code: "REVIEWER_NOT_AUTHORIZED" }, 403);
      case "REVIEWER_AT_CAPACITY": case "NOT_ASSIGNABLE": case "STALE_REVISION": case "VERSION_MISMATCH": return json({ code: e.code }, 409);
      case "ATTESTATION_REQUIRED": return json({ code: "ATTESTATION_REQUIRED" }, 422);
      case "VALIDATION_FAILED": return json({ code: "VALIDATION_FAILED", reason: e.reason }, 422);
    }
  }
  throw e;
}

function guarded(scope: Scope, ids: string[], run: (a: Actor, d: DeepDeps, req: Request, p: Params) => Promise<Response>): Handler {
  return async (deps, req, params = {}) => {
    const actor = await deps.getActor();
    if (!actor) return json({ code: "AUTH_REQUIRED" }, 401);
    if (!allowed(scope, actor.roles)) return json({ code: "FORBIDDEN" }, 403);
    if (ids.some((k) => !UUID.test(params[k] ?? ""))) return notFound();
    try {
      return await run(actor, deps, req, params);
    } catch (e) {
      return mapError(e);
    }
  };
}

// ---- pemilik ----
export const eligibilityHandler = guarded("owner", [], async (a, d, req) => {
  if (!d.flags.deepReviewPurchase) return json({ code: "FEATURE_DISABLED" }, 404);
  const parent = new URL(req.url).searchParams.get("parent") ?? "";
  if (!UUID.test(parent)) return notFound();
  const e = await d.service.eligibility(a.userId, parent, d.now?.());
  // Alasan tidak layak tetap dapat dibaca; pemilik lain/tidak ada diperlakukan sama (404).
  if (e.reason === "NOT_FOUND") return notFound();
  return json(e);
});
export const getOwnerDeepHandler = guarded("owner", ["id"], async (a, d, _r, p) => {
  const r = await d.service.getForOwner(a.userId, p.id);
  return r ? json(r) : notFound();
});

// ---- reviewer ----
export const deepQueueHandler = guarded("reviewer", [], async (a, d) => json({ queue: await d.service.queue(a.userId) }));
export const openDeepHandler = guarded("reviewer", ["id"], async (a, d, _r, p) => json(await d.service.open(a.userId, p.id, d.now?.())));

const draftBody = z.object({ revision: z.number().int().min(0), extraWork: z.string().max(8000), summary: z.string().max(8000) });
export const saveDeepDraftHandler = guarded("reviewer", ["id"], async (a, d, req, p) => {
  const b = draftBody.safeParse(await readJson(req));
  if (!b.success) return invalid();
  return json({ revision: await d.service.saveDraft(a.userId, p.id, b.data.revision, b.data, d.now?.()) });
});

const dispBody = z.object({ revision: z.number().int().min(0), noteNo: z.number().int().positive(), disposition: z.enum(["RESOLVED", "ACCEPTED_RISK", "UNRESOLVED", "OUT_OF_SCOPE"]), evidence: z.string().max(4000) });
export const setDispositionHandler = guarded("reviewer", ["id"], async (a, d, req, p) => {
  const b = dispBody.safeParse(await readJson(req));
  if (!b.success) return invalid();
  return json({ revision: await d.service.setDisposition(a.userId, p.id, b.data.revision, b.data.noteNo, b.data.disposition, b.data.evidence, d.now?.()) });
});

const chkBody = z.object({
  revision: z.number().int().min(0), item: z.enum(["M1", "M2", "M3", "M4", "M5", "M6", "M7"]), result: z.enum(["PASS", "FAIL", "UNKNOWN", "N_A"]),
  reasoning: z.string().max(4000), evidenceRef: z.string().max(4000),
});
export const setChecklistHandler = guarded("reviewer", ["id"], async (a, d, req, p) => {
  const b = chkBody.safeParse(await readJson(req));
  if (!b.success) return invalid();
  return json({ revision: await d.service.setChecklist(a.userId, p.id, b.data.revision, b.data.item, b.data.result, b.data.reasoning, b.data.evidenceRef, d.now?.()) });
});

const decideBody = z.object({
  revision: z.number().int().min(0), decision: z.enum(["APPROVE", "DENY", "INCONCLUSIVE", "REFER_SPECIAL"]),
  reason: z.string().max(2000).nullish(), attest: z.boolean().default(false),
});
export const decideHandler = guarded("reviewer", ["id"], async (a, d, req, p) => {
  const b = decideBody.safeParse(await readJson(req));
  if (!b.success) return invalid();
  // Flag Enhanced mati: APPROVE ditolak sebelum menyentuh DB. Keputusan lain tetap boleh.
  if (b.data.decision === "APPROVE" && !d.flags.enhancedIssuance) return json({ code: "ENHANCED_DISABLED" }, 409);
  return json(await d.service.decide(a.userId, p.id, b.data.revision, b.data.decision, b.data.reason ?? null, b.data.attest, d.now?.()));
});

// ---- koordinator ----
export const deepUnassignedHandler = guarded("coordinator", [], async (a, d) => json({ requests: await d.service.unassigned(a.userId), inflight: await d.service.inflight(a.userId, d.now?.()) }));
const assignBody = z.object({ reviewerId: z.string().regex(UUID) });
export const assignDeepHandler = guarded("coordinator", ["id"], async (a, d, req, p) => {
  const b = assignBody.safeParse(await readJson(req));
  if (!b.success) return invalid();
  await d.service.assign(a.userId, p.id, b.data.reviewerId, d.now?.());
  return json({ ok: true });
});
export const reassignDeepHandler = guarded("coordinator", ["id"], async (a, d, req, p) => {
  const b = assignBody.safeParse(await readJson(req));
  if (!b.success) return invalid();
  await d.service.reassign(a.userId, p.id, b.data.reviewerId, d.now?.());
  return json({ ok: true });
});

import { z } from "zod";
import type { Role } from "@/lib/auth/permissions";
import { homeFor } from "@/lib/auth/permissions";
import { ReviewError, type ReviewService } from "./service";

export type Actor = { userId: string; roles: Role[] };
export type ReviewDeps = { getActor(): Promise<Actor | null>; service: ReviewService; now?: () => Date };
type Params = Record<string, string>;
type Handler = (deps: ReviewDeps, req: Request, params?: Params) => Promise<Response>;
type Scope = "owner" | "reviewer" | "coordinator";

const json = (body: unknown, status = 200) => Response.json(body, { status });
const notFound = () => json({ code: "NOT_FOUND" }, 404);
const invalid = () => json({ code: "INVALID_REQUEST" }, 400);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const readJson = (req: Request) => req.json().catch(() => null);

// Peran sesi hanya pintu masuk; kewenangan sebenarnya (penugasan, otorisasi aktif) diperiksa lagi di database.
function allowed(scope: Scope, roles: Role[]): boolean {
  if (scope === "owner") return homeFor(roles) === "/dashboard";
  if (scope === "reviewer") return roles.includes("reviewer");
  return roles.includes("partner_admin") || roles.includes("platform_admin");
}

function mapError(e: unknown): Response {
  if (e instanceof ReviewError) {
    switch (e.code) {
      // Bukan penugasan/bukan miliknya: tidak membedakan "tidak ada" dari "bukan hakmu".
      case "FORBIDDEN": case "NOT_FOUND": return notFound();
      case "REVIEWER_NOT_AUTHORIZED": return json({ code: "REVIEWER_NOT_AUTHORIZED" }, 403);
      case "REVIEWER_AT_CAPACITY": return json({ code: "REVIEWER_AT_CAPACITY" }, 409);
      case "NOT_ASSIGNABLE": return json({ code: "NOT_ASSIGNABLE" }, 409);
      case "STALE_REVISION": return json({ code: "STALE_REVISION" }, 409);
      case "VERSION_MISMATCH": return json({ code: "VERSION_MISMATCH" }, 409);
      case "ATTESTATION_REQUIRED": return json({ code: "ATTESTATION_REQUIRED" }, 422);
      case "VALIDATION_FAILED": return json({ code: "VALIDATION_FAILED", reason: e.reason }, 422);
    }
  }
  throw e;
}

function guarded(scope: Scope, ids: string[], run: (a: Actor, deps: ReviewDeps, req: Request, p: Params) => Promise<Response>): Handler {
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
export const listOwnerReviewsHandler = guarded("owner", [], async (a, d) => json({ reviews: await d.service.listForOwner(a.userId) }));
export const getOwnerReviewHandler = guarded("owner", ["id"], async (a, d, _r, p) => {
  const r = await d.service.getForOwner(a.userId, p.id);
  return r ? json(r) : notFound();
});

// ---- reviewer ----
export const reviewerQueueHandler = guarded("reviewer", [], async (a, d) => json({ queue: await d.service.queue(a.userId) }));
export const openReviewHandler = guarded("reviewer", ["id"], async (a, d, _r, p) => json(await d.service.open(a.userId, p.id, d.now?.())));

const draftBody = z.object({ revision: z.number().int().min(0), scope: z.string().max(4000), assumptions: z.string().max(4000), summary: z.string().max(8000) });
export const saveDraftHandler = guarded("reviewer", ["id"], async (a, d, req, p) => {
  const b = draftBody.safeParse(await readJson(req));
  if (!b.success) return invalid();
  return json({ revision: await d.service.saveDraft(a.userId, p.id, b.data.revision, b.data, d.now?.()) });
});

const noteBody = z.object({
  revision: z.number().int().min(0), noteNo: z.number().int().positive().optional(), blockId: z.string().max(100).nullish(), quote: z.string().max(1000).nullish(),
  title: z.string().trim().min(1).max(200), finding: z.string().trim().min(1).max(4000), severity: z.enum(["INFO", "MINOR", "MATERIAL", "CRITICAL"]),
  actionable: z.boolean(), recommendedAction: z.string().max(2000).nullish(), rationale: z.string().max(2000).nullish(), escalation: z.string().max(2000).nullish(),
});
export const upsertNoteHandler = guarded("reviewer", ["id"], async (a, d, req, p) => {
  const b = noteBody.safeParse(await readJson(req));
  if (!b.success) return invalid();
  const { revision, ...note } = b.data;
  return json(await d.service.upsertNote(a.userId, p.id, revision, note, d.now?.()));
});
export const deleteNoteHandler = guarded("reviewer", ["id"], async (a, d, req, p) => {
  const rev = Number(new URL(req.url).searchParams.get("revision"));
  const no = Number(p.noteNo);
  if (!Number.isInteger(rev) || rev < 0 || !Number.isInteger(no) || no < 1) return invalid();
  return json({ revision: await d.service.deleteNote(a.userId, p.id, rev, no, d.now?.()) });
});

const publishBody = z.object({
  revision: z.number().int().min(0), outcome: z.enum(["WITH_NOTES", "WITHIN_SCOPE", "INCONCLUSIVE", "DECLINED"]),
  noNotesDeclared: z.boolean().default(false), attest: z.boolean().default(false),
});
export const publishHandler = guarded("reviewer", ["id"], async (a, d, req, p) => {
  const b = publishBody.safeParse(await readJson(req));
  if (!b.success) return invalid();
  return json(await d.service.publish(a.userId, p.id, b.data, d.now?.()));
});

// ---- koordinator ----
export const unassignedHandler = guarded("coordinator", [], async (a, d) => json({ requests: await d.service.unassigned(a.userId), reviewers: await d.service.reviewers(a.userId) }));
const assignBody = z.object({ reviewerId: z.string().regex(UUID) });
export const assignHandler = guarded("coordinator", ["id"], async (a, d, req, p) => {
  const b = assignBody.safeParse(await readJson(req));
  if (!b.success) return invalid();
  await d.service.assign(a.userId, p.id, b.data.reviewerId, d.now?.());
  return json({ ok: true });
});

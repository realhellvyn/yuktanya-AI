import { z } from "zod";
import { diffRendered } from "./diff";
import { UnsupportedCharactersError } from "./export";
import { IntegrityError, NotFoundError, StaleRevisionError, type DocumentsService } from "./service";
import { TemplateNotApprovedError } from "./templates/registry";

export type DocDeps = { getUserId(): Promise<string | null>; service: DocumentsService; now?: () => Date };
// Dilempar getUserId untuk sesi non-pemilik (peran profesional/admin): hanya akun pemilik biasa yang memakai dokumen.
export class ForbiddenError extends Error {
  constructor() {
    super("FORBIDDEN");
    this.name = "ForbiddenError";
  }
}

type Params = Record<string, string>;
type Handler = (deps: DocDeps, req: Request, params?: Params) => Promise<Response>;

const json = (body: unknown, status = 200, headers?: Record<string, string>) => Response.json(body, { status, headers });
// Badan 404 selalu sama, baik ID milik orang lain, tidak ada, maupun bukan UUID.
const notFound = () => json({ code: "NOT_FOUND" }, 404);
const invalid = () => json({ code: "INVALID_REQUEST" }, 400);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idemKey = (req: Request) => {
  const k = req.headers.get("idempotency-key");
  return k && /^[\x21-\x7e]{8,128}$/.test(k) ? k : null;
};
const readJson = (req: Request) => req.json().catch(() => null);

// Membungkus autentikasi, validasi ID, dan pemetaan error umum.
function guarded(ids: string[], run: (userId: string, deps: DocDeps, req: Request, p: Params) => Promise<Response>): Handler {
  return async (deps, req, params = {}) => {
    let userId: string | null;
    try {
      userId = await deps.getUserId();
    } catch (e) {
      if (e instanceof ForbiddenError) return json({ code: "FORBIDDEN" }, 403);
      throw e;
    }
    if (!userId) return json({ code: "AUTH_REQUIRED" }, 401);
    if (ids.some((k) => !UUID.test(params[k] ?? ""))) return notFound();
    try {
      return await run(userId, deps, req, params);
    } catch (e) {
      if (e instanceof NotFoundError) return notFound();
      if (e instanceof StaleRevisionError) return json({ code: "STALE_REVISION" }, 409);
      if (e instanceof TemplateNotApprovedError) return json({ code: "TEMPLATE_NOT_APPROVED" }, 409);
      if (e instanceof IntegrityError) {
        // Dicatat agar kegagalan integritas berkas tidak hilang diam-diam (tanpa isi dokumen).
        console.error("documents.integrity", e.message);
        return json({ code: "INTEGRITY_ERROR" }, 500);
      }
      if (e instanceof UnsupportedCharactersError) return json({ code: "PDF_UNSUPPORTED_CHARACTERS", characters: e.characters }, 422);
      if (e instanceof Error && e.message.includes("TOO_MANY_DRAFTS")) return json({ code: "TOO_MANY_DRAFTS" }, 429);
      throw e;
    }
  };
}

const createBody = z.object({ category: z.enum(["PKS", "UTANG_PIUTANG", "NDA"]) });
const draftBody = z.object({ data: z.record(z.string(), z.union([z.string(), z.number()])), revision: z.number().int().min(0) });
const exportBody = z.object({ format: z.enum(["DOCX", "PDF"]) });

export const createDocumentHandler = guarded([], async (userId, deps, req) => {
  const key = idemKey(req);
  const body = createBody.safeParse(await readJson(req));
  if (!key || !body.success) return invalid();
  return json(await deps.service.create(userId, body.data.category, key), 201);
});

export const listDocumentsHandler = guarded([], async (userId, deps) => json({ documents: await deps.service.list(userId) }));

export const getDocumentHandler = guarded(["id"], async (userId, deps, _req, p) => {
  const doc = await deps.service.get(userId, p.id);
  return doc ? json(doc) : notFound();
});

export const saveDraftHandler = guarded(["id"], async (userId, deps, req, p) => {
  const body = draftBody.safeParse(await readJson(req));
  if (!body.success) return invalid();
  return json(await deps.service.saveDraft(userId, p.id, body.data.data, body.data.revision));
});

export const freezeHandler = guarded(["id"], async (userId, deps, req, p) => {
  const key = idemKey(req);
  if (!key) return invalid();
  const r = await deps.service.freeze(userId, p.id, key, deps.now?.());
  if (r.ok) return json({ versionId: r.versionId, versionNo: r.versionNo, sha256: r.sha256, duplicate: r.duplicate }, r.duplicate ? 200 : 201);
  if (r.code === "VALIDATION_FAILED") return json({ code: r.code, errors: r.errors }, 422);
  if (r.code === "TEMPLATE_NOT_APPROVED") return json({ code: r.code }, 409);
  const now = deps.now?.() ?? new Date();
  const retryAfter = Math.max(1, Math.ceil((new Date(r.resetAt).getTime() - now.getTime()) / 1000));
  return json({ code: r.code, resetAt: r.resetAt }, 429, { "retry-after": String(retryAfter) });
});

export const getVersionHandler = guarded(["versionId"], async (userId, deps, _req, p) => {
  const v = await deps.service.getVersion(userId, p.versionId);
  return v ? json({ id: v.id, documentId: v.documentId, versionNo: v.versionNo, sha256: v.sha256, createdAt: v.createdAt, doc: v.doc }) : notFound();
});

export const diffHandler = guarded(["versionId"], async (userId, deps, req, p) => {
  const against = new URL(req.url).searchParams.get("against") ?? "";
  if (!UUID.test(against)) return notFound();
  const [after, before] = await Promise.all([deps.service.getVersion(userId, p.versionId), deps.service.getVersion(userId, against)]);
  if (!after || !before) return notFound();
  return json({ changes: diffRendered(before.doc, after.doc) });
});

export const exportHandler = guarded(["versionId"], async (userId, deps, req, p) => {
  const body = exportBody.safeParse(await readJson(req));
  if (!body.success) return invalid();
  const r = await deps.service.exportVersion(userId, p.versionId, body.data.format);
  return r ? json(r, 201) : notFound();
});

export const downloadHandler = guarded(["exportId"], async (userId, deps, _req, p) => {
  const f = await deps.service.downloadExport(userId, p.exportId);
  if (!f) return notFound();
  return new Response(f.bytes as BodyInit, {
    status: 200,
    headers: {
      "content-type": f.contentType,
      "content-disposition": `attachment; filename="${f.filename}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
});

export const cloneHandler = guarded(["versionId"], async (userId, deps, req, p) => {
  const key = idemKey(req);
  if (!key) return invalid();
  const r = await deps.service.clone(userId, p.versionId, key);
  return r ? json(r, 201) : notFound();
});

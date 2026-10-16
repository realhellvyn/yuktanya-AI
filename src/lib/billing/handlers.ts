import { z } from "zod";
import { ForbiddenError } from "@/lib/documents/handlers";
import { BillingError, ORDER_KINDS, type BillingService } from "./service";

export type BillingDeps = {
  getUserId(): Promise<string | null>;
  // Hanya platform_admin; null/throw untuk selain itu.
  getAdminId(): Promise<string | null>;
  service: BillingService;
  production: boolean;
  now?: () => Date;
};
type Params = Record<string, string>;
type Handler = (deps: BillingDeps, req: Request, params?: Params) => Promise<Response>;

const json = (body: unknown, status = 200) => Response.json(body, { status });
const notFound = () => json({ code: "NOT_FOUND" }, 404);
const invalid = () => json({ code: "INVALID_REQUEST" }, 400);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idemKey = (req: Request) => {
  const k = req.headers.get("idempotency-key");
  return k && /^[\x21-\x7e]{8,128}$/.test(k) ? k : null;
};
const readJson = (req: Request) => req.json().catch(() => null);

function mapError(e: unknown): Response {
  if (e instanceof BillingError) {
    switch (e.code) {
      case "NOT_FOUND": return notFound();
      case "FORBIDDEN": return json({ code: "FORBIDDEN" }, 403);
      case "ALREADY_REVIEWED": return json({ code: "ALREADY_REVIEWED" }, 409);
      case "PRODUCT_UNAVAILABLE": return json({ code: "PRODUCT_UNAVAILABLE" }, 409);
      case "ORDER_NOT_PAYABLE": return json({ code: "ORDER_NOT_PAYABLE" }, 409);
      case "NOTE_REQUIRED": case "INVALID_ACTION": return invalid();
      case "NOT_RECONCILIATION": case "AMOUNT_MISMATCH": case "CONFLICT": return json({ code: e.code }, 409);
      default: return invalid();
    }
  }
  throw e;
}

function userGuard(ids: string[], run: (userId: string, deps: BillingDeps, req: Request, p: Params) => Promise<Response>): Handler {
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
      return mapError(e);
    }
  };
}

// Harga selalu dihitung server: field amount/plan dari klien diabaikan (skema strict menolak kunci lain tidak dikenal hanya pada field yang disebut).
const orderBody = z.object({ kind: z.enum(ORDER_KINDS as unknown as [string, ...string[]]), versionId: z.string().regex(UUID).optional() }).passthrough();

export const createOrderHandler = userGuard([], async (userId, deps, req) => {
  const key = idemKey(req);
  const body = orderBody.safeParse(await readJson(req));
  if (!key || !body.success) return invalid();
  const { kind, versionId } = body.data;
  if (kind === "STANDARD_REVIEW" && !versionId) return invalid();
  const r = await deps.service.createOrder(userId, kind as never, kind === "STANDARD_REVIEW" ? versionId! : null, key, deps.now?.());
  return json({ orderId: r.orderId, status: r.status, amountIdr: r.amountIdr, duplicate: r.duplicate }, r.duplicate ? 200 : 201);
});

export const getOrderHandler = userGuard(["id"], async (userId, deps, _req, p) => {
  const o = await deps.service.getOrder(userId, p.id);
  return o ? json(o) : notFound();
});

const payBody = z.object({ provider: z.enum(["mock", "manual"]) });
export const payHandler = userGuard(["id"], async (userId, deps, req, p) => {
  const body = payBody.safeParse(await readJson(req));
  if (!body.success) return invalid();
  if (body.data.provider === "mock" && deps.production) return notFound();
  return json(await deps.service.startPayment(userId, p.id, body.data.provider, deps.now?.()), 201);
});

// Mensimulasikan webhook gateway; tidak ada di produksi.
export const mockSettleHandler = userGuard(["id"], async (userId, deps, _req, p) => {
  if (deps.production) return notFound();
  const result = await deps.service.mockSettle(userId, p.id, deps.now?.());
  return json({ result });
});

const confirmBody = z.object({ bankRef: z.string().trim().min(3).max(64), amountIdr: z.number().int().positive(), receivedAt: z.string().datetime().optional() });
export const confirmManualHandler: Handler = async (deps, req, params = {}) => {
  let adminId: string | null;
  try {
    adminId = await deps.getAdminId();
  } catch (e) {
    if (e instanceof ForbiddenError) return json({ code: "FORBIDDEN" }, 403);
    throw e;
  }
  if (!adminId) return json({ code: "AUTH_REQUIRED" }, 401);
  if (!UUID.test(params.id ?? "")) return notFound();
  const body = confirmBody.safeParse(await readJson(req));
  if (!body.success) return invalid();
  try {
    return json({ result: await deps.service.confirmManual(adminId, params.id, body.data.bankRef, body.data.amountIdr, body.data.receivedAt ? new Date(body.data.receivedAt) : null, deps.now?.()) });
  } catch (e) {
    return mapError(e);
  }
};

const resolveBody = z.object({ action: z.enum(["ACTIVATE", "REFUND_RECORDED", "CLOSE"]), note: z.string().trim().min(5).max(300) });
export const resolveReconciliationHandler: Handler = async (deps, req, params = {}) => {
  let adminId: string | null;
  try {
    adminId = await deps.getAdminId();
  } catch (e) {
    if (e instanceof ForbiddenError) return json({ code: "FORBIDDEN" }, 403);
    throw e;
  }
  if (!adminId) return json({ code: "AUTH_REQUIRED" }, 401);
  if (!UUID.test(params.id ?? "")) return notFound();
  const body = resolveBody.safeParse(await readJson(req));
  if (!body.success) return invalid();
  try {
    return json({ result: await deps.service.resolveReconciliation(adminId, params.id, body.data.action, body.data.note, deps.now?.()) });
  } catch (e) {
    return mapError(e);
  }
};

// Gateway nyata (Midtrans/Xendit) belum diputuskan: semua penyedia selain tidak ada → 404.
export const webhookHandler: Handler = async () => notFound();

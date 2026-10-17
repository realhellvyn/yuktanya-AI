import { z } from "zod";
import { ForbiddenError } from "@/lib/documents/handlers";
import { clientIp } from "@/lib/auth/rate-limit";
import { confirmAndApply, MIDTRANS_REF, MidtransError, verifyNotificationSignature, type MidtransConfig } from "./midtrans";
import { BillingError, ORDER_KINDS, type BillingService } from "./service";

export type BillingDeps = {
  getUserId(): Promise<string | null>;
  // Hanya platform_admin; null/throw untuk selain itu.
  getAdminId(): Promise<string | null>;
  service: BillingService;
  production: boolean;
  // Pembelian Deep Review hanya bila flag aktif; selain itu jalur API generik juga menolak.
  deepEnabled?: boolean;
  now?: () => Date;
  // Webhook Midtrans. config null = server key belum diisi (pembayaran belum tersedia).
  midtrans?: { config: MidtransConfig | null; fetchImpl?: typeof fetch; limiter?: { allow(key: string): boolean } };
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
      case "NOT_ELIGIBLE": return json({ code: "NOT_ELIGIBLE", reason: e.reason }, 409);
      case "FORBIDDEN": return json({ code: "FORBIDDEN" }, 403);
      case "ALREADY_REVIEWED": return json({ code: "ALREADY_REVIEWED" }, 409);
      case "PRODUCT_UNAVAILABLE": return json({ code: "PRODUCT_UNAVAILABLE" }, 409);
      case "ORDER_NOT_PAYABLE": return json({ code: "ORDER_NOT_PAYABLE" }, 409);
      case "PROVIDER_UNAVAILABLE": return json({ code: "PROVIDER_UNAVAILABLE" }, 409);
      case "PROVIDER_ERROR": return json({ code: "PROVIDER_ERROR" }, 503);
      case "ORDER_EXPIRING": return json({ code: "ORDER_EXPIRING" }, 409);
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
const orderBody = z.object({ kind: z.enum(ORDER_KINDS as unknown as [string, ...string[]]), versionId: z.string().regex(UUID).optional(), parentRequestId: z.string().regex(UUID).optional() }).passthrough();

export const createOrderHandler = userGuard([], async (userId, deps, req) => {
  const key = idemKey(req);
  const body = orderBody.safeParse(await readJson(req));
  if (!key || !body.success) return invalid();
  const { kind, versionId, parentRequestId } = body.data;
  if (kind === "DEEP_REVIEW" && !deps.deepEnabled) return json({ code: "FEATURE_DISABLED" }, 404);
  if (kind === "STANDARD_REVIEW" && !versionId) return invalid();
  if (kind === "DEEP_REVIEW" && !parentRequestId) return invalid();
  const ref = kind === "STANDARD_REVIEW" ? versionId! : kind === "DEEP_REVIEW" ? parentRequestId! : null;
  const r = await deps.service.createOrder(userId, kind as never, ref, key, deps.now?.());
  return json({ orderId: r.orderId, status: r.status, amountIdr: r.amountIdr, duplicate: r.duplicate }, r.duplicate ? 200 : 201);
});

export const getOrderHandler = userGuard(["id"], async (userId, deps, _req, p) => {
  const o = await deps.service.getOrder(userId, p.id);
  return o ? json(o) : notFound();
});

// Pengguna hanya membayar lewat Midtrans (mock hanya non-produksi). Transfer manual tidak lagi diterima dari pengguna;
// pembayaran manual lama tetap dapat dikonfirmasi admin (confirmManualHandler).
const payBody = z.object({ provider: z.enum(["mock", "midtrans"]) });
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

const MAX_WEBHOOK_BYTES = 16 * 1024;
class TooLarge extends Error {}
async function readLimited(req: Request, max: number): Promise<string> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > max) throw new TooLarge();
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw new TooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

// HTTP Notification Midtrans. Urutan: tanda tangan (SHA-512, waktu-konstan) → konfirmasi Get Status API dengan server key
// → pemetaan status → fungsi DB idempoten. Badan notifikasi hanya dipakai untuk order_id; status dan jumlah dari API.
// 200 = diproses/sudah diproses/diabaikan/transaksi tidak dikenal (UNKNOWN); 401 tanda tangan salah; 5xx hanya untuk
// galat sementara (Midtrans mengulang). Pelunasan hanya membuka pesanan; tidak ada efek persetujuan profesional.
export const webhookHandler: Handler = async (deps, req, params = {}) => {
  if (params.provider !== "midtrans") return notFound();
  const mt = deps.midtrans;
  if (!mt?.config) return json({ code: "PROVIDER_UNAVAILABLE" }, 503);
  if (mt.limiter && !mt.limiter.allow(clientIp(req.headers))) return json({ code: "RATE_LIMITED" }, 429);
  let raw: string;
  try {
    raw = await readLimited(req, MAX_WEBHOOK_BYTES);
  } catch (e) {
    if (e instanceof TooLarge) return json({ code: "PAYLOAD_TOO_LARGE" }, 413);
    return invalid();
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return invalid();
  }
  if (!verifyNotificationSignature(body, mt.config.serverKey)) return json({ code: "INVALID_SIGNATURE" }, 401);
  const orderId = (body as { order_id: string }).order_id;
  // Transaksi lain di akun Midtrans yang sama (bukan buatan Yuktanya): diterima agar tidak diulang, tanpa efek.
  if (!MIDTRANS_REF.test(orderId)) return json({ result: "IGNORED" });
  const now = deps.now?.() ?? new Date();
  try {
    const result = await confirmAndApply(mt.config, orderId, (action, eventId, amount) => deps.service.applyProviderStatus("midtrans", orderId, eventId, action, amount, now), mt.fetchImpl);
    // Tanda tangan sah tetapi transaksi tidak dikenal API status: dicatat (tanpa kunci) dan dibalas 200 agar Midtrans tidak
    // mengulang tanpa guna. Tidak ada perubahan data.
    if (result === null) {
      console.warn("notifikasi Midtrans untuk transaksi yang tidak dikenal API status", orderId);
      return json({ result: "UNKNOWN" });
    }
    // Dana masuk untuk referensi Yuktanya tanpa baris pembayaran: perlu ditangani manual (cek dashboard Midtrans).
    if (result === "NOT_FOUND") console.error("notifikasi Midtrans terkonfirmasi tanpa pembayaran Yuktanya", orderId);
    return json({ result });
  } catch (e) {
    if (e instanceof MidtransError) {
      console.error("konfirmasi status Midtrans gagal", e.code);
      return json({ code: "PROVIDER_ERROR" }, e.code === "UNAVAILABLE" ? 503 : 502);
    }
    console.error("pemrosesan notifikasi Midtrans gagal", e instanceof Error ? e.message.slice(0, 200) : "unknown");
    return json({ code: "INTERNAL" }, 500);
  }
};

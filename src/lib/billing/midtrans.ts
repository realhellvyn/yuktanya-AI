import { createHash, timingSafeEqual } from "node:crypto";
import { MIDTRANS_FORM_ACTION_ORIGINS } from "@/lib/security/headers";

// Klien Midtrans (Snap mode redirect + Get Status API). Hanya dipakai di server; server key tidak pernah masuk ke pesan
// galat, log, atau respons. Bentuk request/response mengikuti klien resmi Midtrans (midtrans-nodejs-client: Snap
// `POST {snap}/snap/v1/transactions`, status `GET {api}/v2/<order_id>/status`, Basic auth "<server key>:") dan dokumentasi
// HTTP Notification (signature_key = SHA512(order_id + status_code + gross_amount + server key)).
const SANDBOX = { snap: "https://app.sandbox.midtrans.com", api: "https://api.sandbox.midtrans.com" };
const PRODUCTION = { snap: "https://app.midtrans.com", api: "https://api.midtrans.com" };
// CSP form-action (src/lib/security/headers.ts): redirect 303 dari server action (tanpa JS) menuju halaman bayar Snap.
export { MIDTRANS_FORM_ACTION_ORIGINS };
const TIMEOUT_MS = 10_000;
// Sisa waktu pesanan minimal agar pembayaran dapat dimulai (pengguna perlu waktu di halaman Midtrans).
export const MIN_PAYMENT_MINUTES = 2;

export type MidtransConfig = {
  serverKey: string;
  mode: "sandbox" | "production";
  snapUrl: string;
  apiBase: string;
  // Asal yang boleh menjadi tujuan redirect pengguna (redirect_url dari Snap divalidasi terhadap daftar ini).
  redirectOrigins: string[];
};
type Env = { MIDTRANS_SERVER_KEY?: string; MIDTRANS_ENV?: string; MIDTRANS_TEST_BASE_URL?: string; NODE_ENV?: string; VERCEL?: string; VERCEL_ENV?: string };

// Server palsu E2E (tests/e2e): hanya alamat loopback yang diterima, sehingga env ini tidak dapat mengalihkan pembayaran
// produksi ke host lain. Di Vercel (VERCEL atau VERCEL_ENV ada) env ini selalu diabaikan.
function loopbackOrigin(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if ((u.protocol !== "http:" && u.protocol !== "https:") || !["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)) return null;
    return u.origin;
  } catch {
    return null;
  }
}

export function midtransConfig(env: Env = process.env): MidtransConfig | null {
  const serverKey = (env.MIDTRANS_SERVER_KEY ?? "").trim();
  if (!serverKey) return null;
  const mode = (env.MIDTRANS_ENV ?? "").trim() === "production" ? "production" : "sandbox";
  const onVercel = Boolean(env.VERCEL || env.VERCEL_ENV);
  const test = onVercel ? null : loopbackOrigin(env.MIDTRANS_TEST_BASE_URL);
  const base = test ? { snap: test, api: test } : mode === "production" ? PRODUCTION : SANDBOX;
  return { serverKey, mode, snapUrl: `${base.snap}/snap/v1/transactions`, apiBase: base.api, redirectOrigins: [base.snap] };
}

export class MidtransError extends Error {
  // UNAVAILABLE: jaringan/5xx/kunci ditolak (sementara, boleh diulang). REJECTED: Snap menolak permintaan.
  // BAD_RESPONSE: respons tidak sesuai bentuk yang diharapkan.
  constructor(readonly code: "UNAVAILABLE" | "REJECTED" | "BAD_RESPONSE", detail: string) {
    super(`MIDTRANS_${code}: ${detail}`);
    this.name = "MidtransError";
  }
}

const authHeader = (key: string) => `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
const headers = (key: string) => ({ accept: "application/json", "content-type": "application/json", authorization: authHeader(key) });

async function call(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  } catch (e) {
    throw new MidtransError("UNAVAILABLE", e instanceof Error ? e.name : "network");
  }
}
async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    const v = await res.json();
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// "yyyy-MM-dd HH:mm:ss +0700" (format expiry.start_time Snap), selalu WIB.
function wib(d: Date): string {
  const t = new Date(d.getTime() + 7 * 3600_000).toISOString();
  return `${t.slice(0, 10)} ${t.slice(11, 19)} +0700`;
}

export type SnapInput = { providerRef: string; amountIdr: number; itemId: string; itemName: string; finishUrl: string; expiresAt: Date; now: Date };

// Data pribadi minimum: tanpa customer_details (nama/email/telepon/alamat tidak dikirim; Snap tidak mewajibkannya).
export async function createSnapTransaction(cfg: MidtransConfig, input: SnapInput, fetchImpl: typeof fetch = fetch): Promise<{ token: string; redirectUrl: string }> {
  const duration = Math.floor((input.expiresAt.getTime() - input.now.getTime()) / 60_000);
  if (duration < MIN_PAYMENT_MINUTES) throw new MidtransError("REJECTED", "sisa waktu pesanan terlalu singkat");
  const body = {
    transaction_details: { order_id: input.providerRef, gross_amount: input.amountIdr },
    item_details: [{ id: input.itemId, price: input.amountIdr, quantity: 1, name: input.itemName.slice(0, 50) }],
    callbacks: { finish: input.finishUrl },
    expiry: { start_time: wib(input.now), unit: "minute", duration },
    credit_card: { secure: true },
  };
  const res = await call(fetchImpl, cfg.snapUrl, { method: "POST", headers: headers(cfg.serverKey), body: JSON.stringify(body) });
  if (res.status >= 500) throw new MidtransError("UNAVAILABLE", `snap http ${res.status}`);
  const data = await readJson(res);
  if (res.status >= 400) {
    const msgs = Array.isArray(data?.error_messages) ? (data.error_messages as unknown[]).map(String).join("; ").slice(0, 300) : "";
    throw new MidtransError("REJECTED", `snap http ${res.status} ${msgs}`);
  }
  const token = data?.token, redirect = data?.redirect_url;
  if (typeof token !== "string" || typeof redirect !== "string") throw new MidtransError("BAD_RESPONSE", "snap tanpa token/redirect_url");
  let origin: string | null = null;
  try {
    origin = new URL(redirect).origin;
  } catch {
    origin = null;
  }
  if (!origin || !cfg.redirectOrigins.includes(origin)) throw new MidtransError("BAD_RESPONSE", "redirect_url di luar domain Midtrans");
  return { token, redirectUrl: redirect };
}

export type MidtransStatus = {
  orderId: string; transactionId: string; transactionStatus: string; fraudStatus: string | null; grossAmount: string; currency: string | null;
};

// Status terkonfirmasi dari Midtrans (sumber kebenaran, bukan badan notifikasi). null = transaksi tidak dikenal Midtrans.
export async function getTransactionStatus(cfg: MidtransConfig, orderId: string, fetchImpl: typeof fetch = fetch): Promise<MidtransStatus | null> {
  const res = await call(fetchImpl, `${cfg.apiBase}/v2/${encodeURIComponent(orderId)}/status`, { method: "GET", headers: headers(cfg.serverKey) });
  if (res.status === 404) return null;
  if (res.status >= 500 || res.status === 401 || res.status === 403) throw new MidtransError("UNAVAILABLE", `status http ${res.status}`);
  const data = await readJson(res);
  if (!data) throw new MidtransError("BAD_RESPONSE", `status http ${res.status} bukan JSON`);
  const code = String(data.status_code ?? "");
  if (code === "404") return null;
  if (code === "401" || code === "403" || code.startsWith("5")) throw new MidtransError("UNAVAILABLE", `status_code ${code}`);
  const s = (k: string) => (typeof data[k] === "string" ? (data[k] as string) : null);
  const out = { orderId: s("order_id"), transactionId: s("transaction_id"), transactionStatus: s("transaction_status"), grossAmount: s("gross_amount") };
  if (res.status >= 400 || out.orderId !== orderId || !out.transactionId || !out.transactionStatus || !out.grossAmount) {
    throw new MidtransError("BAD_RESPONSE", `status http ${res.status} status_code ${code}`);
  }
  return { ...(out as Omit<MidtransStatus, "fraudStatus" | "currency">), fraudStatus: s("fraud_status"), currency: s("currency") };
}

export function verifyNotificationSignature(body: unknown, serverKey: string): boolean {
  if (!serverKey || !body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  const fields = [b.order_id, b.status_code, b.gross_amount, b.signature_key];
  if (!fields.every((x) => typeof x === "string" && x.length > 0 && x.length <= 512)) return false;
  const expected = Buffer.from(createHash("sha512").update(`${b.order_id}${b.status_code}${b.gross_amount}${serverKey}`).digest("hex"));
  const given = Buffer.from(b.signature_key as string);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export type GatewayAction = { kind: "SETTLE" } | { kind: "FAIL"; status: "FAILED" | "EXPIRED" } | { kind: "RECORD" };

// Pemetaan status Midtrans → tindakan. Status lain (pending, challenge, authorize, refund, chargeback, tak dikenal) hanya
// dicatat; refund dilakukan manual di dashboard Midtrans lalu dicatat admin (docs/RUNBOOK.md).
export function mapStatus(transactionStatus: string, fraudStatus?: string | null): GatewayAction {
  if (transactionStatus === "settlement") return { kind: "SETTLE" };
  if (transactionStatus === "capture") return fraudStatus === "accept" ? { kind: "SETTLE" } : { kind: "RECORD" };
  if (transactionStatus === "expire") return { kind: "FAIL", status: "EXPIRED" };
  if (["cancel", "deny", "failure"].includes(transactionStatus)) return { kind: "FAIL", status: "FAILED" };
  return { kind: "RECORD" };
}

export const eventIdFor = (s: Pick<MidtransStatus, "transactionId" | "transactionStatus" | "fraudStatus">) =>
  `${s.transactionId}:${s.transactionStatus}${s.transactionStatus === "capture" ? `:${s.fraudStatus ?? "none"}` : ""}`.slice(0, 200);

// "50000.00" → 50000. Hanya Rupiah bulat positif; selain itu null (diperlakukan sebagai jumlah tidak cocok).
export function parseAmount(gross: string): number | null {
  const m = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(gross);
  if (!m || (m[2] && Number(m[2]) !== 0)) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

// Referensi pembayaran Midtrans buatan Yuktanya (order_id di Midtrans).
export const MIDTRANS_REF = /^ytk-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Nama item di halaman bayar (≤50 karakter, tanpa data dokumen).
export const ITEM_NAMES: Record<string, string> = {
  MEMBERSHIP_MONTHLY: "Membership Yuktanya (1 periode)", MEMBERSHIP_ANNUAL: "Membership Yuktanya (1 tahun)", BUNDLE: "Paket kredit Legal Review",
  STANDARD_REVIEW: "Legal Review Yuktanya", DEEP_REVIEW: "Deep Review Yuktanya (tambahan)",
};

// Konfirmasi ke Get Status API lalu terapkan (dipakai webhook dan tombol "Perbarui status"). Status, jumlah, dan id event
// selalu dari API, bukan dari badan notifikasi atau parameter URL. null = transaksi tidak dikenal Midtrans.
export async function confirmAndApply(
  cfg: MidtransConfig, orderId: string,
  apply: (action: GatewayAction, eventId: string, amountIdr: number | null) => Promise<string>,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const s = await getTransactionStatus(cfg, orderId, fetchImpl);
  if (!s) return null;
  const amount = s.currency && s.currency !== "IDR" ? null : parseAmount(s.grossAmount);
  return apply(mapStatus(s.transactionStatus, s.fraudStatus), eventIdFor(s), amount);
}

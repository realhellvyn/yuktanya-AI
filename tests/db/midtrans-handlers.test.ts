// Task 21: adaptor, layanan, dan webhook Midtrans terhadap DB uji, dengan Snap/Status API palsu (fetch tiruan).
import { createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createManualAdapter, createMidtransAdapter, createMockAdapter } from "@/lib/billing/adapters";
import { payHandler, webhookHandler, type BillingDeps } from "@/lib/billing/handlers";
import { midtransConfig } from "@/lib/billing/midtrans";
import { BillingError, createPgBillingService } from "@/lib/billing/service";
import { ForbiddenError } from "@/lib/documents/handlers";
import { createUser, getPool } from "./helpers";
import { at, makeKit, NOW } from "./phase3-helpers";

const pool = getPool();
afterAll(() => pool.end());
const kit = makeKit(pool);
const KEY = "SB-Mid-server-uji-handler";
const cfg = midtransConfig({ MIDTRANS_SERVER_KEY: KEY, MIDTRANS_ENV: "sandbox" })!;
const REDIRECT = (t: string) => `https://app.sandbox.midtrans.com/snap/v4/redirection/${t}`;

// Midtrans palsu: Snap create + status per order_id (diatur tes).
function fakeMidtrans(c = cfg) {
  const statuses = new Map<string, Record<string, unknown> | "DOWN">();
  const snapBodies: Record<string, unknown>[] = [];
  let snapDown = false;
  let statusCalls = 0;
  const impl = (async (url: string, init: RequestInit) => {
    const u = String(url);
    if (new Headers(init.headers).get("authorization") !== `Basic ${Buffer.from(`${KEY}:`).toString("base64")}`) return Response.json({ status_code: "401" }, { status: 401 });
    if (u === c.snapUrl) {
      if (snapDown) return new Response("down", { status: 503 });
      const b = JSON.parse(String(init.body));
      snapBodies.push(b);
      return Response.json({ token: `tok-${snapBodies.length}`, redirect_url: `${c.redirectOrigins[0]}/snap/v4/redirection/tok-${snapBodies.length}` }, { status: 201 });
    }
    const m = /\/v2\/([^/]+)\/status$/.exec(u);
    if (m) {
      statusCalls++;
      const s = statuses.get(decodeURIComponent(m[1]));
      if (s === "DOWN") return new Response("x", { status: 502 });
      return s ? Response.json(s) : Response.json({ status_code: "404", status_message: "Transaction doesn't exist." });
    }
    return new Response("?", { status: 418 });
  }) as unknown as typeof fetch;
  return {
    impl, snapBodies, statuses,
    setSnapDown: (v: boolean) => (snapDown = v),
    get statusCalls() { return statusCalls; },
    paid: (orderId: string, gross: string, status = "settlement", extra: Record<string, unknown> = {}) =>
      statuses.set(orderId, { status_code: status === "settlement" ? "200" : "201", transaction_status: status, order_id: orderId, transaction_id: `tx-${orderId.slice(4, 12)}`, gross_amount: gross, currency: "IDR", fraud_status: "accept", ...extra }),
  };
}

const sign = (orderId: string, code: string, gross: string, key = KEY) => createHash("sha512").update(`${orderId}${code}${gross}${key}`).digest("hex");
const notification = (orderId: string, gross: string, status = "settlement", code = "200", key = KEY) =>
  ({ order_id: orderId, status_code: code, gross_amount: gross, transaction_status: status, transaction_id: "tx-dari-badan", signature_key: sign(orderId, code, gross, key) });
const hook = (body: unknown, raw?: string) => new Request("http://t/api/payments/webhook/midtrans", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7" }, body: raw ?? JSON.stringify(body) });

function setup(over: Partial<BillingDeps> = {}, c = cfg) {
  const mt = fakeMidtrans(c);
  const service = createPgBillingService(pool, [createMockAdapter(), createManualAdapter("Transfer uji"), createMidtransAdapter(c, () => "https://yuktanya.com", mt.impl)]);
  const deps = (userId: string | null, o: Partial<BillingDeps> = {}): BillingDeps => ({
    getUserId: async () => userId, getAdminId: async () => { throw new ForbiddenError(); }, service, production: true, now: () => NOW,
    midtrans: { config: c, fetchImpl: mt.impl }, ...over, ...o,
  });
  return { mt, service, deps };
}
const payReq = (provider: string) => new Request("http://t/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider }) });
const refOf = async (paymentId: string) => (await pool.query("select provider_ref from payments where id = $1", [paymentId])).rows[0].provider_ref as string;
const orderStatus = async (id: string) => (await pool.query("select status from orders where id = $1", [id])).rows[0].status as string;

describe("adaptor + layanan Midtrans", () => {
  it("startPayment: Snap menerima jumlah dari DB, ref ytk-<uuid>, finish ke checkout, kedaluwarsa pesanan; klik ulang memakai URL yang sama", async () => {
    const { mt, service } = setup();
    const u = await createUser(pool);
    const o = await kit.order(u, "MEMBERSHIP_MONTHLY", null);
    const r = await service.startPayment(u, o.order_id, "midtrans", NOW);
    expect(r.redirectUrl).toBe(REDIRECT("tok-1"));
    const b = mt.snapBodies[0] as { transaction_details: { order_id: string; gross_amount: number }; callbacks: { finish: string }; expiry: { duration: number }; item_details: { name: string }[] };
    expect(b.transaction_details.gross_amount).toBe(19000);
    expect(b.transaction_details.order_id).toMatch(/^ytk-[0-9a-f-]{36}$/);
    expect(b.callbacks.finish).toBe(`https://yuktanya.com/checkout/${o.order_id}`);
    expect(b.expiry.duration).toBe(24 * 60);
    expect(b.item_details[0].name).toBe("Membership Yuktanya (1 periode)");
    expect(await refOf(r.paymentId)).toBe(b.transaction_details.order_id);
    const again = await service.startPayment(u, o.order_id, "midtrans", at(5));
    expect(again).toEqual(r);
    expect(mt.snapBodies).toHaveLength(1);
  });

  it("galat Snap → PROVIDER_ERROR dan TIDAK ada pembayaran; pesanan kedaluwarsa ditolak tanpa memanggil Snap", async () => {
    const { mt, service } = setup();
    const u = await createUser(pool);
    const o = await kit.order(u, "MEMBERSHIP_MONTHLY", null);
    mt.setSnapDown(true);
    await expect(service.startPayment(u, o.order_id, "midtrans", NOW)).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
    expect((await pool.query("select count(*)::int as n from payments where order_id = $1", [o.order_id])).rows[0].n).toBe(0);
    mt.setSnapDown(false);
    await expect(service.startPayment(u, o.order_id, "midtrans", at(25 * 60))).rejects.toBeInstanceOf(BillingError);
    expect(mt.snapBodies).toHaveLength(0);
  });

  it("refreshHosted (tombol Perbarui status): status dari API Midtrans, hanya pembayaran milik pengguna", async () => {
    const { mt, service } = setup();
    const u = await createUser(pool);
    const o = await kit.order(u, "MEMBERSHIP_MONTHLY", null);
    const r = await service.startPayment(u, o.order_id, "midtrans", NOW);
    const ref = await refOf(r.paymentId);
    expect(await service.refreshHosted(await createUser(pool), o.order_id, cfg, mt.impl, NOW)).toEqual([]);
    expect(await service.refreshHosted(u, o.order_id, cfg, mt.impl, NOW)).toEqual(["NOT_FOUND"]);
    expect(await orderStatus(o.order_id)).toBe("PENDING_PAYMENT");
    mt.paid(ref, "19000.00");
    expect(await service.refreshHosted(u, o.order_id, cfg, mt.impl, NOW)).toEqual(["SETTLED"]);
    expect(await orderStatus(o.order_id)).toBe("PAID");
  });
});

describe("perbaikan review Task 21 (M2–M4)", () => {
  const payStatus = async (id: string) => (await pool.query("select status from payments where id = $1", [id])).rows[0].status as string;

  it("M2: URL tersimpan dari asal Snap lain (Sandbox setelah pindah ke Production) → pembayaran lama EXPIRED, transaksi baru di asal aktif", async () => {
    const sb = setup();
    const u = await createUser(pool);
    const o = await kit.order(u, "MEMBERSHIP_MONTHLY", null);
    const a = await sb.service.startPayment(u, o.order_id, "midtrans", NOW);
    expect(new URL(a.redirectUrl!).origin).toBe("https://app.sandbox.midtrans.com");
    const prodCfg = midtransConfig({ MIDTRANS_SERVER_KEY: KEY, MIDTRANS_ENV: "production" })!;
    const pr = setup({}, prodCfg);
    const b = await pr.service.startPayment(u, o.order_id, "midtrans", at(1));
    expect(b.paymentId).not.toBe(a.paymentId);
    expect(new URL(b.redirectUrl!).origin).toBe("https://app.midtrans.com");
    expect(pr.mt.snapBodies).toHaveLength(1);
    expect(await payStatus(a.paymentId)).toBe("EXPIRED");
    expect(await payStatus(b.paymentId)).toBe("PENDING");
    expect(await orderStatus(o.order_id)).toBe("PENDING_PAYMENT");
    // Klik berikutnya di Production memakai ulang transaksi Production yang sama.
    expect(await pr.service.startPayment(u, o.order_id, "midtrans", at(2))).toEqual(b);
  });

  it("M2: dana yang sudah VERIFIED tidak pernah dilepas; pesanan lunas → ORDER_NOT_PAYABLE tanpa memanggil Snap", async () => {
    const sb = setup();
    const u = await createUser(pool);
    const o = await kit.order(u, "MEMBERSHIP_MONTHLY", null);
    const a = await sb.service.startPayment(u, o.order_id, "midtrans", NOW);
    sb.mt.paid(await refOf(a.paymentId), "19000.00");
    expect(await sb.service.refreshHosted(u, o.order_id, cfg, sb.mt.impl, NOW)).toEqual(["SETTLED"]);
    const pr = setup({}, midtransConfig({ MIDTRANS_SERVER_KEY: KEY, MIDTRANS_ENV: "production" })!);
    await expect(pr.service.startPayment(u, o.order_id, "midtrans", at(1))).rejects.toMatchObject({ code: "ORDER_NOT_PAYABLE" });
    expect(pr.mt.snapBodies).toHaveLength(0);
    expect(await payStatus(a.paymentId)).toBe("VERIFIED");
  });

  it("M3: Perbarui status juga memeriksa pembayaran FAILED selama pesanan masih menunggu (ditolak lalu berhasil)", async () => {
    const { mt, service, deps } = setup();
    const u = await createUser(pool);
    const o = await kit.order(u, "MEMBERSHIP_MONTHLY", null);
    const a = await service.startPayment(u, o.order_id, "midtrans", NOW);
    const ref = await refOf(a.paymentId);
    mt.paid(ref, "19000.00", "deny", { status_code: "202" });
    expect((await (await webhookHandler(deps(null), hook(notification(ref, "19000.00", "deny", "202")), { provider: "midtrans" })).json()).result).toBe("FAILED");
    expect(await service.refreshHosted(u, o.order_id, cfg, mt.impl, NOW)).toEqual(["DUPLICATE"]);
    mt.paid(ref, "19000.00");
    expect(await service.refreshHosted(u, o.order_id, cfg, mt.impl, NOW)).toEqual(["SETTLED"]);
    expect(await orderStatus(o.order_id)).toBe("PAID");
    expect(await payStatus(a.paymentId)).toBe("VERIFIED");
  });

  it("M3: pembayaran FAILED pada pesanan yang sudah lunas lewat transaksi lain tidak ikut diperiksa", async () => {
    const { mt, service } = setup();
    const u = await createUser(pool);
    const o = await kit.order(u, "MEMBERSHIP_MONTHLY", null);
    const a = await service.startPayment(u, o.order_id, "midtrans", NOW);
    await pool.query("select fail_payment('midtrans', $1, 'uji:deny', 'FAILED', $2)", [await refOf(a.paymentId), NOW]);
    const b = await service.startPayment(u, o.order_id, "midtrans", at(1));
    mt.paid(await refOf(b.paymentId), "19000.00");
    // Selama pesanan menunggu, yang FAILED ikut diperiksa (tidak dikenal Midtrans → NOT_FOUND); setelah lunas tidak lagi.
    expect(await service.refreshHosted(u, o.order_id, cfg, mt.impl, NOW)).toEqual(["NOT_FOUND", "SETTLED"]);
    expect(await service.refreshHosted(u, o.order_id, cfg, mt.impl, NOW)).toEqual([]);
  });

  it("M4: sisa waktu pesanan < 2 menit → ORDER_EXPIRING; kasus khusus terbuka → SPECIAL_CASE_OPEN; Snap tidak dipanggil", async () => {
    const { mt, service, deps } = setup();
    const u = await createUser(pool);
    const o = await kit.order(u, "MEMBERSHIP_MONTHLY", null);
    await expect(service.startPayment(u, o.order_id, "midtrans", at(24 * 60 - 1.5))).rejects.toMatchObject({ code: "ORDER_EXPIRING" });
    const res = await payHandler(deps(u, { now: () => at(24 * 60 - 1.5) }), payReq("midtrans"), { id: o.order_id });
    expect([res.status, (await res.json()).code]).toEqual([409, "ORDER_EXPIRING"]);
    const owner = await createUser(pool);
    const v = await kit.frozen(owner);
    const so = await kit.order(owner, "STANDARD_REVIEW", v.versionId);
    await pool.query("select submit_special_case($1, $2, $3, true, $4, $5)", [owner, v.documentId, "Perjanjian distribusi lintas provinsi dengan klausul eksklusivitas dan denda besar.", `k-${Math.random()}-abcdef`, NOW]);
    await expect(service.startPayment(owner, so.order_id, "midtrans", NOW)).rejects.toMatchObject({ code: "SPECIAL_CASE_OPEN" });
    expect(mt.snapBodies).toHaveLength(0);
    expect((await pool.query("select count(*)::int as n from payments where order_id = any($1)", [[o.order_id, so.order_id]])).rows[0].n).toBe(0);
    // Tepat 2 menit tersisa masih boleh.
    expect((await service.startPayment(u, o.order_id, "midtrans", at(24 * 60 - 2))).redirectUrl).toBeTruthy();
  });
});

describe("payHandler", () => {
  it("pengguna tidak dapat lagi memilih transfer manual; midtrans → 201 + redirectUrl; mock di produksi 404", async () => {
    const { deps } = setup();
    const u = await createUser(pool);
    const o = await kit.order(u, "MEMBERSHIP_MONTHLY", null);
    expect((await payHandler(deps(u), payReq("manual"), { id: o.order_id })).status).toBe(400);
    expect((await payHandler(deps(u), payReq("mock"), { id: o.order_id })).status).toBe(404);
    const res = await payHandler(deps(u), payReq("midtrans"), { id: o.order_id });
    expect(res.status).toBe(201);
    expect((await res.json()).redirectUrl).toBe(REDIRECT("tok-1"));
  });

  it("Snap gagal → 503 PROVIDER_ERROR (pesan jelas di klien), bukan 500", async () => {
    const { deps, mt } = setup();
    mt.setSnapDown(true);
    const u = await createUser(pool);
    const o = await kit.order(u, "MEMBERSHIP_MONTHLY", null);
    const res = await payHandler(deps(u), payReq("midtrans"), { id: o.order_id });
    expect([res.status, (await res.json()).code]).toEqual([503, "PROVIDER_ERROR"]);
  });
});

describe("webhook Midtrans", () => {
  async function pendingPayment() {
    const s = setup();
    const u = await createUser(pool);
    const o = await kit.order(u, "MEMBERSHIP_MONTHLY", null);
    const p = await s.service.startPayment(u, o.order_id, "midtrans", NOW);
    return { ...s, u, o, ref: await refOf(p.paymentId), paymentId: p.paymentId };
  }

  it("tanda tangan sah + status API settlement → lunas (200); notifikasi ulang → 200 tanpa aktivasi ganda", async () => {
    const t = await pendingPayment();
    t.mt.paid(t.ref, "19000.00");
    const res = await webhookHandler(t.deps(null), hook(notification(t.ref, "19000.00")), { provider: "midtrans" });
    expect([res.status, (await res.json()).result]).toEqual([200, "SETTLED"]);
    expect(await orderStatus(t.o.order_id)).toBe("PAID");
    const again = await webhookHandler(t.deps(null), hook(notification(t.ref, "19000.00")), { provider: "midtrans" });
    expect([again.status, (await again.json()).result]).toEqual([200, "DUPLICATE"]);
    expect((await pool.query("select count(*)::int as n from memberships where user_id = $1", [t.u])).rows[0].n).toBe(1);
  });

  it("tanda tangan salah → 401 tanpa memanggil API status; pesanan tetap belum lunas", async () => {
    const t = await pendingPayment();
    t.mt.paid(t.ref, "19000.00");
    const res = await webhookHandler(t.deps(null), hook(notification(t.ref, "19000.00", "settlement", "200", "SB-Mid-server-kunci-bocor-lain")), { provider: "midtrans" });
    expect(res.status).toBe(401);
    expect(t.mt.statusCalls).toBe(0);
    expect(await orderStatus(t.o.order_id)).toBe("PENDING_PAYMENT");
  });

  it("notifikasi bertanda tangan sah tetapi API status belum lunas → tidak dilunasi (badan notifikasi tidak dipercaya)", async () => {
    const t = await pendingPayment();
    t.mt.paid(t.ref, "19000.00", "pending");
    const res = await webhookHandler(t.deps(null), hook(notification(t.ref, "19000.00", "settlement")), { provider: "midtrans" });
    expect([res.status, (await res.json()).result]).toEqual([200, "RECORDED"]);
    expect(await orderStatus(t.o.order_id)).toBe("PENDING_PAYMENT");
    // M5: transaksi tidak dikenal Midtrans → 200 UNKNOWN (tidak diulang tanpa guna), tanpa pelunasan.
    const t2 = await pendingPayment();
    const res2 = await webhookHandler(t2.deps(null), hook(notification(t2.ref, "19000.00")), { provider: "midtrans" });
    expect([res2.status, (await res2.json()).result]).toEqual([200, "UNKNOWN"]);
    expect(await orderStatus(t2.o.order_id)).toBe("PENDING_PAYMENT");
  });

  it("jumlah dari API status berbeda → tidak lunas, pesanan masuk rekonsiliasi", async () => {
    const t = await pendingPayment();
    t.mt.paid(t.ref, "1900.00");
    const res = await webhookHandler(t.deps(null), hook(notification(t.ref, "1900.00")), { provider: "midtrans" });
    expect([res.status, (await res.json()).result]).toEqual([200, "AMOUNT_MISMATCH"]);
    expect(await orderStatus(t.o.order_id)).toBe("RECONCILIATION_REQUIRED");
  });

  it("expire → pembayaran EXPIRED, pesanan tetap dapat dibayar ulang dengan transaksi Snap baru", async () => {
    const t = await pendingPayment();
    t.mt.paid(t.ref, "19000.00", "expire", { status_code: "407" });
    const res = await webhookHandler(t.deps(null), hook(notification(t.ref, "19000.00", "expire", "407")), { provider: "midtrans" });
    expect([res.status, (await res.json()).result]).toEqual([200, "EXPIRED"]);
    expect((await pool.query("select status from payments where id = $1", [t.paymentId])).rows[0].status).toBe("EXPIRED");
    expect(await orderStatus(t.o.order_id)).toBe("PENDING_PAYMENT");
    const again = await t.service.startPayment(t.u, t.o.order_id, "midtrans", at(10));
    expect(again.paymentId).not.toBe(t.paymentId);
    expect(again.redirectUrl).toBe(REDIRECT("tok-2"));
    // deny → FAILED.
    const ref2 = await refOf(again.paymentId);
    t.mt.paid(ref2, "19000.00", "deny", { status_code: "202" });
    expect((await (await webhookHandler(t.deps(null), hook(notification(ref2, "19000.00", "deny", "202")), { provider: "midtrans" })).json()).result).toBe("FAILED");
  });

  it("Legal Review dibayar lewat webhook → permintaan pemeriksaan masuk antrean (tanpa persetujuan profesional apa pun)", async () => {
    const owner = await createUser(pool);
    const v = await kit.frozen(owner);
    const s = setup();
    const o = await kit.order(owner, "STANDARD_REVIEW", v.versionId);
    const p = await s.service.startPayment(owner, o.order_id, "midtrans", NOW);
    const ref = await refOf(p.paymentId);
    s.mt.paid(ref, `${o.amount_idr}.00`);
    expect((await (await webhookHandler(s.deps(null), hook(notification(ref, `${o.amount_idr}.00`)), { provider: "midtrans" })).json()).result).toBe("SETTLED");
    const rr = (await pool.query("select status from review_requests where order_id = $1", [o.order_id])).rows;
    expect(rr.map((r) => r.status)).toEqual(["QUEUED"]);
    expect((await pool.query("select count(*)::int as n from document_verifications where version_id = $1 and kind <> 'AI'", [v.versionId])).rows[0].n).toBe(0);
  });

  it("provider lain 404; tanpa server key 503; badan terlalu besar 413; JSON rusak 400; order_id bukan milik Yuktanya → 200 diabaikan", async () => {
    const t = await pendingPayment();
    expect((await webhookHandler(t.deps(null), hook({}), { provider: "xendit" })).status).toBe(404);
    expect((await webhookHandler(t.deps(null), hook({}), { provider: "mock" })).status).toBe(404);
    expect((await webhookHandler(t.deps(null, { midtrans: { config: null } }), hook(notification(t.ref, "19000.00")), { provider: "midtrans" })).status).toBe(503);
    expect((await webhookHandler(t.deps(null), hook(null, JSON.stringify({ pad: "x".repeat(20_000) })), { provider: "midtrans" })).status).toBe(413);
    expect((await webhookHandler(t.deps(null), hook(null, "{rusak"), { provider: "midtrans" })).status).toBe(400);
    const other = await webhookHandler(t.deps(null), hook(notification("order-lain-123", "10000.00")), { provider: "midtrans" });
    expect([other.status, (await other.json()).result]).toEqual([200, "IGNORED"]);
    expect(t.mt.statusCalls).toBe(0);
  });

  it("API status sedang gangguan → 503 (Midtrans mengulang), pesanan tidak berubah; batas laju → 429", async () => {
    const t = await pendingPayment();
    t.mt.statuses.set(t.ref, "DOWN");
    expect((await webhookHandler(t.deps(null), hook(notification(t.ref, "19000.00")), { provider: "midtrans" })).status).toBe(503);
    expect(await orderStatus(t.o.order_id)).toBe("PENDING_PAYMENT");
    const limited = t.deps(null, { midtrans: { config: cfg, fetchImpl: t.mt.impl, limiter: { allow: () => false } } });
    expect((await webhookHandler(limited, hook(notification(t.ref, "19000.00")), { provider: "midtrans" })).status).toBe(429);
  });
});

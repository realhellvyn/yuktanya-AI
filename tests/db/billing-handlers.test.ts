import { afterAll, describe, expect, it } from "vitest";
import { createManualAdapter, createMockAdapter } from "@/lib/billing/adapters";
import { confirmManualHandler, createOrderHandler, getOrderHandler, mockSettleHandler, payHandler, webhookHandler, type BillingDeps } from "@/lib/billing/handlers";
import { createPgBillingService } from "@/lib/billing/service";
import { ForbiddenError } from "@/lib/documents/handlers";
import { createUser, getPool } from "./helpers";
import { makeKit, NOW } from "./phase3-helpers";

const pool = getPool();
afterAll(() => pool.end());
const kit = makeKit(pool);
const service = createPgBillingService(pool, [createMockAdapter(), createManualAdapter("Transfer ke rekening uji")]);
const deps = (userId: string | null, over: Partial<BillingDeps> = {}): BillingDeps => ({
  getUserId: async () => userId, getAdminId: async () => { throw new ForbiddenError(); }, service, production: false, now: () => NOW, ...over,
});
const post = (body: unknown, key: string | null = `idem-${Math.random().toString(36).slice(2)}-abcd`) =>
  new Request("http://t/x", { method: "POST", headers: { "content-type": "application/json", ...(key ? { "idempotency-key": key } : {}) }, body: JSON.stringify(body) });
const ID = "00000000-0000-4000-8000-000000000000";

describe("handler penagihan", () => {
  it("anonim → 401 di semua handler", async () => {
    const d = deps(null, { getAdminId: async () => null });
    for (const r of [await createOrderHandler(d, post({ kind: "MEMBERSHIP_MONTHLY" })), await getOrderHandler(d, post({}), { id: ID }),
      await payHandler(d, post({ provider: "mock" }), { id: ID }), await mockSettleHandler(d, post({}), { id: ID }), await confirmManualHandler(d, post({}), { id: ID })]) {
      expect(r.status).toBe(401);
    }
  });

  it("harga dari klien diabaikan; kunci sama dua kali → satu order", async () => {
    const u = await createUser(pool);
    const d = deps(u);
    const k = "idem-same-key-12345";
    const a = await createOrderHandler(d, post({ kind: "MEMBERSHIP_MONTHLY", amount: 1, plan: "MEMBER", amountIdr: 1 }, k));
    const b = await createOrderHandler(d, post({ kind: "MEMBERSHIP_MONTHLY" }, k));
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    const [x, y] = [await a.json(), await b.json()];
    expect(x.amountIdr).toBe(19000);
    expect(y.orderId).toBe(x.orderId);
  });

  it("order tanpa Idempotency-Key atau review tanpa versionId → 400", async () => {
    const d = deps(await createUser(pool));
    expect((await createOrderHandler(d, post({ kind: "MEMBERSHIP_MONTHLY" }, null))).status).toBe(400);
    expect((await createOrderHandler(d, post({ kind: "STANDARD_REVIEW" }))).status).toBe(400);
  });

  it("order milik orang lain 404 dengan badan identik dengan ID acak", async () => {
    const owner = await createUser(pool);
    const o = await kit.order(owner, "MEMBERSHIP_MONTHLY", null);
    const other = deps(await createUser(pool));
    const a = await getOrderHandler(other, post({}), { id: o.order_id });
    const b = await getOrderHandler(other, post({}), { id: ID });
    expect([a.status, await a.text()]).toEqual([b.status, await b.text()]);
    expect(a.status).toBe(404);
  });

  it("review: versi orang lain 404, versi sudah punya order 409 ALREADY_REVIEWED, tanpa harga dari klien", async () => {
    const owner = await createUser(pool);
    const v = await kit.frozen(owner);
    const other = deps(await createUser(pool));
    expect((await createOrderHandler(other, post({ kind: "STANDARD_REVIEW", versionId: v.versionId }))).status).toBe(404);
    const d = deps(owner);
    const first = await createOrderHandler(d, post({ kind: "STANDARD_REVIEW", versionId: v.versionId, amount: 1 }));
    expect((await first.json()).amountIdr).toBe(50000);
    const again = await createOrderHandler(d, post({ kind: "STANDARD_REVIEW", versionId: v.versionId }));
    expect([again.status, (await again.json()).code]).toEqual([409, "ALREADY_REVIEWED"]);
  });

  it("produk tanpa harga → 409 PRODUCT_UNAVAILABLE", async () => {
    await pool.query("delete from price_catalog where kind in ('MEMBERSHIP_ANNUAL', 'BUNDLE')");
    const r = await createOrderHandler(deps(await createUser(pool)), post({ kind: "MEMBERSHIP_ANNUAL" }));
    expect([r.status, (await r.json()).code]).toEqual([409, "PRODUCT_UNAVAILABLE"]);
  });

  it("mock settle: non-produksi menyelesaikan order dan membuat Member aktif; produksi → 404", async () => {
    const u = await createUser(pool);
    const d = deps(u);
    const o = await (await createOrderHandler(d, post({ kind: "MEMBERSHIP_MONTHLY" }))).json();
    const pay = await (await payHandler(d, post({ provider: "mock" }), { id: o.orderId })).json();
    const prod = await mockSettleHandler(deps(u, { production: true }), post({}), { id: pay.paymentId });
    expect(prod.status).toBe(404);
    expect((await payHandler(deps(u, { production: true }), post({ provider: "mock" }), { id: o.orderId })).status).toBe(404);
    const ok = await mockSettleHandler(d, post({}), { id: pay.paymentId });
    expect((await ok.json()).result).toBe("SETTLED");
    expect((await pool.query("select plan from resolve_entitlement($1, $2)", [u, NOW])).rows[0].plan).toBe("MEMBER");
  });

  it("mock settle untuk pembayaran orang lain → 404", async () => {
    const owner = await createUser(pool);
    const o = await (await createOrderHandler(deps(owner), post({ kind: "MEMBERSHIP_MONTHLY" }))).json();
    const pay = await (await payHandler(deps(owner), post({ provider: "mock" }), { id: o.orderId })).json();
    expect((await mockSettleHandler(deps(await createUser(pool)), post({}), { id: pay.paymentId })).status).toBe(404);
  });

  it("konfirmasi manual: non-admin 403, admin menyelesaikan; instruksi manual muncul", async () => {
    const u = await createUser(pool);
    const o = await (await createOrderHandler(deps(u), post({ kind: "MEMBERSHIP_MONTHLY" }))).json();
    const pay = await (await payHandler(deps(u), post({ provider: "manual" }), { id: o.orderId })).json();
    expect(pay.instructions).toBe("Transfer ke rekening uji");
    const body = { bankRef: "BANK-777", amountIdr: 19000 };
    expect((await confirmManualHandler(deps(u), post(body), { id: pay.paymentId })).status).toBe(403);
    const admin = await kit.admin();
    const d = deps(u, { getAdminId: async () => admin });
    expect((await (await confirmManualHandler(d, post(body), { id: pay.paymentId })).json()).result).toBe("SETTLED");
    expect((await pool.query("select plan from resolve_entitlement($1, $2)", [u, NOW])).rows[0].plan).toBe("MEMBER");
  });

  it("webhook penyedia selain mock → 404", async () => {
    expect((await webhookHandler(deps(null), post({}), { provider: "midtrans" })).status).toBe(404);
  });

  it("instruksi manual kosong → pesan belum tersedia", async () => {
    const s = createPgBillingService(pool, [createManualAdapter("")]);
    const u = await createUser(pool);
    const o = await s.createOrder(u, "MEMBERSHIP_MONTHLY", null, "idem-instr-12345", NOW);
    expect((await s.startPayment(u, o.orderId, "manual", NOW)).instructions).toContain("belum tersedia");
  });
});

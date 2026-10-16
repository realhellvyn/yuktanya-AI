import { afterAll, describe, expect, it } from "vitest";
import { createManualAdapter, createMockAdapter } from "@/lib/billing/adapters";
import { expireOrdersJobHandler } from "@/lib/billing/jobs";
import { getMembershipState } from "@/lib/billing/membership";
import { createPgBillingService } from "@/lib/billing/service";
import { createUser, getPool } from "./helpers";
import { at, key, makeKit, NOW } from "./phase3-helpers";

// Regresi audit A (A15, A21, A22, A23): integritas entitlement, pembayaran ganda, fulfilment membership, kedaluwarsa.
const pool = getPool();
afterAll(() => pool.end());
const kit = makeKit(pool);
const svc = createPgBillingService(pool, [createMockAdapter(), createManualAdapter("Transfer ke rekening uji")]);
const ent = async (orderId: string) => (await pool.query("select status from review_discount_entitlements where order_id = $1", [orderId])).rows[0]?.status as string | undefined;
const row = async (table: string, id: string) => (await pool.query(`select * from ${table} where id = $1`, [id])).rows[0];
const resolve = (admin: string, orderId: string, action: string, now: Date) =>
  pool.query("select admin_resolve_reconciliation($1, $2, $3, 'dana diterima terlambat', $4) as r", [admin, orderId, action, now]);
type Overview = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const overview = async (admin: string): Promise<Overview> =>
  (await pool.query("select admin_overview($1, $2, $3) as o", [admin, new Date("2026-10-15T17:00:00Z"), new Date("2026-10-19T00:00:00Z")])).rows[0].o;
const held = (o: Overview) => (o.revenue?.held ?? 0) as number;

describe("A15: aktivasi rekonsiliasi order Member pertama tidak menggandakan diskon periode", () => {
  it("diskon periode masih bebas: ACTIVATE memesan ulang lalu memakai entitlement order itu; order berikutnya Rp35.000", async () => {
    await pool.query("update firms set is_default = false");
    const admin = await kit.admin();
    const u = await kit.member("2026-10-01", "2026-11-01");
    const a = await kit.order(u, "STANDARD_REVIEW", (await kit.frozen(u)).versionId);
    expect(a.amount_idr).toBe(30000);
    const pa = await kit.pay(u, a.order_id);
    expect(await kit.settle("mock", pa.ref, 30000, at(26 * 60))).toBe("RECONCILIATION_REQUIRED");
    expect(await ent(a.order_id)).toBe("RELEASED");
    expect((await resolve(admin, a.order_id, "ACTIVATE", at(27 * 60))).rows[0].r).toBe("ACTIVATED");
    expect(await ent(a.order_id)).toBe("CONSUMED");
    const next = await kit.order(u, "STANDARD_REVIEW", (await kit.frozen(u)).versionId, at(28 * 60));
    expect(next.amount_idr).toBe(35000);
  });

  it("diskon periode sudah dipakai order lain: ACTIVATE ditolak DISCOUNT_TAKEN, uang tetap tercatat di rekonsiliasi, lalu dapat dicatat pengembaliannya", async () => {
    await pool.query("update firms set is_default = false");
    const admin = await kit.admin();
    const u = await kit.member("2026-10-01", "2026-11-01");
    const a = await kit.order(u, "STANDARD_REVIEW", (await kit.frozen(u)).versionId);
    const pa = await kit.pay(u, a.order_id);
    const b = await kit.order(u, "STANDARD_REVIEW", (await kit.frozen(u)).versionId, at(25 * 60));
    expect(b.amount_idr).toBe(30000);
    const pb = await kit.pay(u, b.order_id, "mock", at(25 * 60));
    expect(await kit.settle("mock", pb.ref, 30000, at(25 * 60))).toBe("SETTLED");
    expect(await kit.settle("mock", pa.ref, 30000, at(26 * 60))).toBe("RECONCILIATION_REQUIRED");
    await expect(resolve(admin, a.order_id, "ACTIVATE", at(27 * 60))).rejects.toThrow(/DISCOUNT_TAKEN/);
    await expect(svc.resolveReconciliation(admin, a.order_id, "ACTIVATE", "dana diterima terlambat", at(27 * 60))).rejects.toMatchObject({ code: "DISCOUNT_TAKEN" });
    expect((await row("orders", a.order_id)).status).toBe("RECONCILIATION_REQUIRED");
    expect((await row("payments", pa.paymentId)).status).toBe("DISPUTED");
    const paidFirst = await pool.query(
      "select count(*)::int as n from orders o where o.user_id = $1 and o.status = 'PAID' and o.price_snapshot ->> 'variant' = 'MEMBER_FIRST'", [u]);
    expect(paidFirst.rows[0].n).toBe(1);
    expect((await resolve(admin, a.order_id, "REFUND_RECORDED", at(28 * 60))).rows[0].r).toBe("REFUND_RECORDED");
    expect((await row("payments", pa.paymentId)).status).toBe("REFUNDED");
  });
});

describe("A21: pembayaran kedua pada order yang sudah lunas terlihat dan dapat direkonsiliasi", () => {
  it("klik ganda 'bayar' dengan metode sama memakai pembayaran PENDING yang sama", async () => {
    const u = await createUser(pool);
    const o = await kit.order(u, "MEMBERSHIP_MONTHLY", null);
    const p1 = await kit.pay(u, o.order_id, "manual");
    const p2 = await kit.pay(u, o.order_id, "manual");
    expect(p2.paymentId).toBe(p1.paymentId);
    expect((await pool.query("select count(*)::int as n from payments where order_id = $1", [o.order_id])).rows[0].n).toBe(1);
  });

  it("pembayaran kedua DISPUTED pada order PAID: muncul di daftar manual selagi menunggu, lalu di rekonsiliasi dan angka ditahan; pengembalian dana dicatat tanpa membatalkan order", async () => {
    const admin = await kit.admin();
    const u = await createUser(pool);
    const o = await kit.order(u, "MEMBERSHIP_MONTHLY", null);
    const p1 = await kit.pay(u, o.order_id, "mock");
    const p2 = await kit.pay(u, o.order_id, "manual");
    expect(await kit.settle("mock", p1.ref, 19000)).toBe("SETTLED");
    expect((await row("orders", o.order_id)).status).toBe("PAID");
    expect((await svc.pendingManualPayments()).some((r) => r.paymentId === p2.paymentId)).toBe(true);
    const before = held(await overview(admin));
    expect(await svc.confirmManual(admin, p2.paymentId, "BANK-DUP", 19000, null, NOW)).toBe("RECONCILIATION_REQUIRED");
    expect((await row("payments", p2.paymentId)).status).toBe("DISPUTED");
    expect((await row("orders", o.order_id)).status).toBe("PAID");
    const rec = await svc.reconciliation();
    const item = rec.find((r) => r.paymentId === p2.paymentId);
    expect(item).toMatchObject({ orderId: o.order_id, status: "PAID", extraPayment: true, amountIdr: 19000 });
    expect(held(await overview(admin)) - before).toBe(19000);
    await expect(resolve(admin, o.order_id, "ACTIVATE", NOW)).rejects.toThrow(/NOT_RECONCILIATION/);
    expect(await svc.resolveReconciliation(admin, o.order_id, "REFUND_RECORDED", "transfer ganda dikembalikan", NOW)).toBe("REFUND_RECORDED");
    expect((await row("payments", p2.paymentId)).status).toBe("REFUNDED");
    expect((await row("payments", p1.paymentId)).status).toBe("VERIFIED");
    expect((await row("orders", o.order_id)).status).toBe("PAID");
    expect((await pool.query("select count(*)::int as n from memberships where user_id = $1", [u])).rows[0].n).toBe(1);
    expect((await svc.reconciliation()).some((r) => r.paymentId === p2.paymentId)).toBe(false);
    expect(held(await overview(admin)) - before).toBe(0);
  });

  it("transfer manual yang ordernya sudah kedaluwarsa tetap tampil di daftar konfirmasi (uang terlambat tidak hilang dari pandangan admin)", async () => {
    const u = await createUser(pool);
    const o = await kit.order(u, "MEMBERSHIP_MONTHLY", null);
    const p = await kit.pay(u, o.order_id, "manual");
    await pool.query("select expire_orders($1)", [at(25 * 60)]);
    expect((await row("payments", p.paymentId)).status).toBe("EXPIRED");
    const listed = (await svc.pendingManualPayments()).find((r) => r.paymentId === p.paymentId);
    expect(listed).toMatchObject({ orderId: o.order_id, expired: true });
  });
});

describe("A22: fulfilment membership berurutan per pengguna dan order tertunda dipakai ulang", () => {
  it("dua settlement membership serentak tidak menghasilkan periode yang tumpang tindih", async () => {
    const admin = await kit.admin();
    await pool.query("select set_price($1, 'MEMBERSHIP_ANNUAL', 'DEFAULT', 190000, null, null)", [admin]);
    const u = await createUser(pool);
    const o1 = await kit.order(u, "MEMBERSHIP_MONTHLY", null);
    const o2 = await kit.order(u, "MEMBERSHIP_ANNUAL", null);
    const p1 = await kit.pay(u, o1.order_id);
    const p2 = await kit.pay(u, o2.order_id);
    const a = await pool.connect();
    try {
      await a.query("begin");
      expect((await a.query("select settle_payment('mock', $1, $2, 19000, 0, $3) as r", [p1.ref, `evA-${key()}`, NOW])).rows[0].r).toBe("SETTLED");
      const b = pool.query("select settle_payment('mock', $1, $2, 190000, 0, $3) as r", [p2.ref, `evB-${key()}`, NOW]);
      const raced = await Promise.race([b.then(() => "selesai"), new Promise((r) => setTimeout(() => r("menunggu"), 1000))]);
      expect(raced).toBe("menunggu");
      await a.query("commit");
      expect((await b).rows[0].r).toBe("SETTLED");
    } finally {
      // Tanpa transaksi terbuka (sudah commit) rollback hanya peringatan; bila gagal di tengah, klien tidak kembali ke pool dalam transaksi.
      await a.query("rollback").catch(() => undefined);
      a.release();
    }
    const overlap = await pool.query(
      `select count(*)::int as n from memberships x join memberships y on x.user_id = y.user_id and x.id < y.id
        and x.period_start < y.period_end and y.period_start < x.period_end where x.user_id = $1`, [u]);
    expect(overlap.rows[0].n).toBe(0);
    expect((await pool.query("select count(*)::int as n from memberships where user_id = $1", [u])).rows[0].n).toBe(13);
  });

  it("klik ganda 'Lanjut ke pembayaran' (kunci berbeda, serentak) memakai satu order membership tertunda", async () => {
    const u = await createUser(pool);
    const rs = await Promise.all(Array.from({ length: 4 }, () => svc.createOrder(u, "MEMBERSHIP_MONTHLY", null, key(), NOW)));
    expect(new Set(rs.map((r) => r.orderId)).size).toBe(1);
    expect(rs.filter((r) => !r.duplicate)).toHaveLength(1);
    expect((await pool.query("select count(*)::int as n from orders where user_id = $1", [u])).rows[0].n).toBe(1);
  });

  it("order baru tetap dibuat setelah order tertunda dibayar atau kedaluwarsa; kunci idempotensi yang sama tetap mengembalikan order semula", async () => {
    const u = await createUser(pool);
    const k1 = key();
    const first = await svc.createOrder(u, "MEMBERSHIP_MONTHLY", null, k1, NOW);
    expect((await svc.createOrder(u, "MEMBERSHIP_MONTHLY", null, k1, NOW)).orderId).toBe(first.orderId);
    const expiredLater = await svc.createOrder(u, "MEMBERSHIP_MONTHLY", null, key(), at(25 * 60));
    expect(expiredLater.orderId).not.toBe(first.orderId);
    expect((await row("orders", first.orderId)).status).toBe("EXPIRED");
    const p = await kit.pay(u, expiredLater.orderId, "mock", at(25 * 60));
    expect(await kit.settle("mock", p.ref, 19000, at(25 * 60))).toBe("SETTLED");
    const renewal = await svc.createOrder(u, "MEMBERSHIP_MONTHLY", null, key(), at(26 * 60));
    expect(renewal.orderId).not.toBe(expiredLater.orderId);
    expect(renewal.duplicate).toBe(false);
  });
});

describe("A23: order kedaluwarsa tidak memengaruhi harga yang ditampilkan dan disapu terjadwal", () => {
  it("pratinjau harga dan kartu membership mengabaikan order Member pertama yang sudah lewat batas bayar", async () => {
    const u = await kit.member("2026-10-01", "2026-11-01");
    await kit.order(u, "STANDARD_REVIEW", (await kit.frozen(u)).versionId);
    const v2 = await kit.frozen(u);
    const later = at(25 * 60);
    const st = await getMembershipState(pool, u, later);
    expect(st.active && st.firstReviewUsed).toBe(false);
    expect(await svc.preview(u, "STANDARD_REVIEW", v2.versionId, later)).toMatchObject({ amountIdr: 30000, variant: "MEMBER_FIRST" });
    expect((await kit.order(u, "STANDARD_REVIEW", v2.versionId, later)).amount_idr).toBe(30000);
  });

  it("sapuan terjadwal yang berpapasan dengan settlement tepat waktu tidak menandai order lunas sebagai kedaluwarsa", async () => {
    const u = await createUser(pool);
    const o = await kit.order(u, "MEMBERSHIP_MONTHLY", null);
    const p = await kit.pay(u, o.order_id, "manual");
    const a = await pool.connect();
    try {
      await a.query("begin");
      // Dana diterima tepat waktu (menit ke-60), dikonfirmasi setelah batas bayar lewat.
      expect((await a.query("select settle_payment('manual', $1, $2, 19000, 0, $3, $4) as r", [p.ref, `ev-${key()}`, at(25 * 60), at(60)])).rows[0].r).toBe("SETTLED");
      const sweep = pool.query("select expire_orders($1) as n", [at(25 * 60)]);
      await new Promise((r) => setTimeout(r, 300));
      await a.query("commit");
      await sweep;
    } finally {
      await a.query("rollback").catch(() => undefined);
      a.release();
    }
    expect((await row("orders", o.order_id)).status).toBe("PAID");
    expect((await row("payments", p.paymentId)).status).toBe("VERIFIED");
  });

  it("job kedaluwarsa: tanpa/salah rahasia ditolak; rahasia benar menyapu order lewat batas dan melepas diskon", async () => {
    const u = await kit.member("2026-10-01", "2026-11-01");
    const o = await kit.order(u, "STANDARD_REVIEW", (await kit.frozen(u)).versionId);
    const call = (secret: string | undefined, h?: string) =>
      expireOrdersJobHandler({ pool, secret, now: () => at(25 * 60) }, new Request("http://t/api/jobs/expire-orders", { headers: h ? { authorization: h } : {} }));
    expect((await call(undefined, "Bearer x")).status).toBe(503);
    expect((await call("rahasia-panjang-123")).status).toBe(401);
    expect((await call("rahasia-panjang-123", "Bearer salah")).status).toBe(401);
    expect((await row("orders", o.order_id)).status).toBe("PENDING_PAYMENT");
    const res = await call("rahasia-panjang-123", "Bearer rahasia-panjang-123");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ expired: expect.any(Number) });
    expect((await row("orders", o.order_id)).status).toBe("EXPIRED");
    expect(await ent(o.order_id)).toBe("RELEASED");
  });
});

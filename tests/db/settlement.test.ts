import { afterAll, describe, expect, it } from "vitest";
import { asUser, createUser, getPool } from "./helpers";
import { at, makeKit, NOW } from "./phase3-helpers";

const pool = getPool();
afterAll(() => pool.end());
const kit = makeKit(pool);
const ent = async (u: string, now: Date = NOW) => (await pool.query("select * from resolve_entitlement($1, $2)", [u, now])).rows[0].plan as string;
const row = async (table: string, id: string) => (await pool.query(`select * from ${table} where id = $1`, [id])).rows[0];

describe("settlement", () => {
  it("settle sukses: payment VERIFIED, order PAID, Member aktif dengan periode benar", async () => {
    const u = await createUser(pool);
    const o = await kit.order(u, "MEMBERSHIP_MONTHLY", null);
    expect(await ent(u)).toBe("FREE");
    const p = await kit.pay(u, o.order_id);
    expect(await kit.settle("mock", p.ref, 19000, NOW, "ev-1", 700)).toBe("SETTLED");
    expect((await row("payments", p.paymentId)).status).toBe("VERIFIED");
    expect((await row("payments", p.paymentId)).fee_idr).toBe(700);
    expect((await row("orders", o.order_id)).status).toBe("PAID");
    expect(await ent(u)).toBe("MEMBER");
    const m = (await pool.query("select period_start, period_end from memberships where user_id = $1 and status = 'ACTIVE'", [u])).rows;
    expect(m).toHaveLength(1);
    expect(m[0].period_start.toISOString()).toBe(NOW.toISOString());
    expect(m[0].period_end.toISOString()).toBe("2026-11-16T05:00:00.000Z");
  });

  it("perpanjangan dirantai pada akhir periode berjalan", async () => {
    const u = await kit.member("2026-10-01", "2026-11-01");
    const r = await kit.buy(u, "MEMBERSHIP_MONTHLY", null);
    expect(r.settled).toBe("SETTLED");
    const ms = (await pool.query("select period_start, period_end from memberships where user_id = $1 order by period_start", [u])).rows;
    expect(ms).toHaveLength(2);
    expect(ms[1].period_start.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(ms[1].period_end.toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });

  it("callback ganda dan serentak dengan event_id sama → satu aktivasi", async () => {
    const u = await createUser(pool);
    const o = await kit.order(u, "MEMBERSHIP_MONTHLY", null);
    const p = await kit.pay(u, o.order_id);
    const rs = await Promise.all(Array.from({ length: 5 }, () => kit.settle("mock", p.ref, 19000, NOW, "same-event")));
    expect(rs.filter((r) => r === "SETTLED")).toHaveLength(1);
    expect(rs.filter((r) => r === "DUPLICATE")).toHaveLength(4);
    expect((await pool.query("select count(*) from memberships where user_id = $1", [u])).rows[0].count).toBe("1");
  });

  it("event_id berbeda untuk pembayaran yang sudah VERIFIED → DUPLICATE tanpa aktivasi kedua", async () => {
    const u = await createUser(pool);
    const o = await kit.order(u, "MEMBERSHIP_MONTHLY", null);
    const p = await kit.pay(u, o.order_id);
    await kit.settle("mock", p.ref, 19000);
    expect(await kit.settle("mock", p.ref, 19000, NOW, "ev-lain")).toBe("DUPLICATE");
    expect((await pool.query("select count(*) from memberships where user_id = $1", [u])).rows[0].count).toBe("1");
  });

  it("jumlah salah → AMOUNT_MISMATCH, payment DISPUTED, tanpa aktivasi", async () => {
    const u = await createUser(pool);
    const o = await kit.order(u, "MEMBERSHIP_MONTHLY", null);
    const p = await kit.pay(u, o.order_id);
    expect(await kit.settle("mock", p.ref, 1000)).toBe("AMOUNT_MISMATCH");
    expect((await row("payments", p.paymentId)).status).toBe("DISPUTED");
    expect((await row("orders", o.order_id)).status).toBe("RECONCILIATION_REQUIRED");
    expect(await ent(u)).toBe("FREE");
  });

  it("setelah order kedaluwarsa → RECONCILIATION_REQUIRED tanpa aktivasi", async () => {
    const u = await createUser(pool);
    const o = await kit.order(u, "MEMBERSHIP_MONTHLY", null);
    const p = await kit.pay(u, o.order_id);
    expect(await kit.settle("mock", p.ref, 19000, at(25 * 60))).toBe("RECONCILIATION_REQUIRED");
    expect((await row("orders", o.order_id)).status).toBe("RECONCILIATION_REQUIRED");
    expect(await ent(u, at(25 * 60))).toBe("FREE");
  });

  it("provider_ref tak dikenal → NOT_FOUND", async () => {
    expect(await kit.settle("mock", "tidak-ada", 19000)).toBe("NOT_FOUND");
  });

  it("pembayaran untuk order orang lain atau yang sudah kedaluwarsa tidak dapat dibuat", async () => {
    const owner = await createUser(pool);
    const other = await createUser(pool);
    const o = await kit.order(owner, "MEMBERSHIP_MONTHLY", null);
    await expect(kit.pay(other, o.order_id)).rejects.toThrow(/NOT_FOUND/);
    await expect(kit.pay(owner, o.order_id, "mock", at(25 * 60))).rejects.toThrow(/ORDER_NOT_PAYABLE/);
  });

  it("provider di luar mock/manual/midtrans ditolak", async () => {
    const u = await createUser(pool);
    const o = await kit.order(u, "MEMBERSHIP_MONTHLY", null);
    await expect(kit.pay(u, o.order_id, "xendit")).rejects.toThrow();
  });

  it("membership tanpa settlement tidak memberi kuota Member", async () => {
    const u = await createUser(pool);
    await kit.order(u, "MEMBERSHIP_MONTHLY", null);
    expect(await ent(u)).toBe("FREE");
    expect((await pool.query("select count(*) from memberships where user_id = $1", [u])).rows[0].count).toBe("0");
  });

  it("paket tahunan → 12 periode berurutan dan masing-masing memberi satu diskon pertama", async () => {
    const admin = await kit.admin();
    await pool.query("select set_price($1, 'MEMBERSHIP_ANNUAL', 'DEFAULT', 190000, null, null)", [admin]);
    const u = await createUser(pool);
    expect((await kit.buy(u, "MEMBERSHIP_ANNUAL", null)).settled).toBe("SETTLED");
    const ms = (await pool.query("select period_start, period_end from memberships where user_id = $1 order by period_start", [u])).rows;
    expect(ms).toHaveLength(12);
    for (let i = 1; i < 12; i++) expect(ms[i].period_start.toISOString()).toBe(ms[i - 1].period_end.toISOString());
    const v1 = await kit.frozen(u);
    const v2 = await kit.frozen(u);
    const later = at(60 * 24 * 40);
    expect((await kit.order(u, "STANDARD_REVIEW", v1.versionId, later)).amount_idr).toBe(30000);
    expect((await kit.order(u, "STANDARD_REVIEW", v2.versionId, later)).amount_idr).toBe(35000);
  });

  it("bundle menghasilkan kredit berumur sesuai katalog", async () => {
    const admin = await kit.admin();
    await pool.query("select set_price($1, 'BUNDLE', 'DEFAULT', 100000, 3, 90)", [admin]);
    const u = await createUser(pool);
    expect((await kit.buy(u, "BUNDLE", null)).settled).toBe("SETTLED");
    const c = (await pool.query("select expires_at, status from review_credits where user_id = $1", [u])).rows;
    expect(c).toHaveLength(3);
    expect(c.every((x) => x.status === "AVAILABLE")).toBe(true);
    expect(c[0].expires_at.toISOString()).toBe("2027-01-14T05:00:00.000Z");
  });

  it("confirm_manual_payment: non-admin FORBIDDEN, admin menyelesaikan dan tercatat di audit", async () => {
    const u = await createUser(pool);
    const o = await kit.order(u, "MEMBERSHIP_MONTHLY", null);
    const p = await kit.pay(u, o.order_id, "manual");
    await expect(pool.query("select confirm_manual_payment($1, $2, 'BANK-1', 19000, $3)", [u, p.paymentId, NOW])).rejects.toThrow(/FORBIDDEN/);
    const admin = await kit.admin();
    expect((await pool.query("select confirm_manual_payment($1, $2, 'BANK-1', 19000, $3) as r", [admin, p.paymentId, NOW])).rows[0].r).toBe("SETTLED");
    expect(await ent(u)).toBe("MEMBER");
    expect((await pool.query("select count(*) from audit_events where event_type = 'manual_payment_confirmed' and entity_id = $1", [p.paymentId])).rows[0].count).toBe("1");
  });

  it("authenticated tidak dapat memanggil fungsi atau membaca tabel pembayaran", async () => {
    const u = await createUser(pool);
    await expect(asUser(pool, u, (c) => c.query("select settle_payment('mock', 'x', 'e', 1, 0, now())"))).rejects.toThrow(/permission denied/);
    await expect(asUser(pool, u, (c) => c.query("select * from payments"))).rejects.toThrow(/permission denied/);
    await expect(asUser(pool, u, (c) => c.query("select * from payment_events"))).rejects.toThrow(/permission denied/);
  });

  it("review: order kedaluwarsa → pesan ulang → pembayaran order lama datang terlambat tidak melempar dan tercatat sebagai rekonsiliasi", async () => {
    await pool.query("update firms set is_default = false");
    const u = await createUser(pool);
    const v = await kit.frozen(u);
    const a = await kit.order(u, "STANDARD_REVIEW", v.versionId);
    const pa = await kit.pay(u, a.order_id);
    const later = at(25 * 60);
    const b = await kit.order(u, "STANDARD_REVIEW", v.versionId, later);
    expect(b.order_id).not.toBe(a.order_id);
    expect(await kit.settle("mock", pa.ref, a.amount_idr, later)).toBe("RECONCILIATION_REQUIRED");
    expect((await row("orders", a.order_id)).status).toBe("RECONCILIATION_REQUIRED");
    expect((await row("payments", pa.paymentId)).status).toBe("DISPUTED");
    expect((await pool.query("select count(*) from review_requests where version_id = $1", [v.versionId])).rows[0].count).toBe("0");
  });

  it("AMOUNT_MISMATCH pada order Member pertama melepas diskon yang dipesan", async () => {
    const u = await kit.member();
    const v = await kit.frozen(u);
    const o = await kit.order(u, "STANDARD_REVIEW", v.versionId);
    const p = await kit.pay(u, o.order_id);
    expect(await kit.settle("mock", p.ref, 1)).toBe("AMOUNT_MISMATCH");
    expect((await pool.query("select status from review_discount_entitlements where order_id = $1", [o.order_id])).rows[0].status).toBe("RELEASED");
    const v2 = await kit.frozen(u);
    expect((await kit.order(u, "STANDARD_REVIEW", v2.versionId)).amount_idr).toBe(30000);
  });

  it("transfer manual dinilai dari waktu dana diterima, bukan waktu admin menekan konfirmasi", async () => {
    const u = await createUser(pool);
    const o = await kit.order(u, "MEMBERSHIP_MONTHLY", null);
    const p = await kit.pay(u, o.order_id, "manual");
    const admin = await kit.admin();
    const monday = at(3 * 24 * 60);
    const r = await pool.query("select confirm_manual_payment($1, $2, 'BANK-9', 19000, $3, $4) as r", [admin, p.paymentId, monday, at(60)]);
    expect(r.rows[0].r).toBe("SETTLED");
    expect(await ent(u, monday)).toBe("MEMBER");
    const o2 = await kit.order(u, "MEMBERSHIP_MONTHLY", null, at(10 * 24 * 60));
    const p2 = await kit.pay(u, o2.order_id, "manual", at(10 * 24 * 60));
    const late = (await pool.query("select confirm_manual_payment($1, $2, 'BANK-10', 19000, $3, $4) as r", [admin, p2.paymentId, at(12 * 24 * 60), at(12 * 24 * 60)])).rows[0].r;
    expect(late).toBe("RECONCILIATION_REQUIRED");
  });

  it("admin_resolve_reconciliation: ACTIVATE hanya bila masih valid, REFUND_RECORDED melepas dan tidak dapat dua kali, non-admin FORBIDDEN, tercatat di audit", async () => {
    const admin = await kit.admin();
    const u = await createUser(pool);
    const o = await kit.order(u, "MEMBERSHIP_MONTHLY", null);
    const p = await kit.pay(u, o.order_id);
    await kit.settle("mock", p.ref, 19000, at(25 * 60));
    expect((await row("orders", o.order_id)).status).toBe("RECONCILIATION_REQUIRED");
    await expect(pool.query("select admin_resolve_reconciliation($1, $2, 'ACTIVATE', 'cek bank ok', $3)", [u, o.order_id, at(26 * 60)])).rejects.toThrow(/FORBIDDEN/);
    await expect(pool.query("select admin_resolve_reconciliation($1, $2, 'ACTIVATE', 'x', $3)", [admin, o.order_id, at(26 * 60)])).rejects.toThrow(/NOTE_REQUIRED/);
    expect((await pool.query("select admin_resolve_reconciliation($1, $2, 'ACTIVATE', 'dana terbukti diterima', $3) as r", [admin, o.order_id, at(26 * 60)])).rows[0].r).toBe("ACTIVATED");
    expect(await ent(u, at(26 * 60))).toBe("MEMBER");
    await expect(pool.query("select admin_resolve_reconciliation($1, $2, 'ACTIVATE', 'sekali lagi ok', $3)", [admin, o.order_id, at(27 * 60)])).rejects.toThrow(/NOT_RECONCILIATION/);

    const u2 = await createUser(pool);
    const o2 = await kit.order(u2, "MEMBERSHIP_MONTHLY", null);
    const p2 = await kit.pay(u2, o2.order_id);
    await kit.settle("mock", p2.ref, 5);
    expect((await pool.query("select admin_resolve_reconciliation($1, $2, 'REFUND_RECORDED', 'dikembalikan via bank', $3) as r", [admin, o2.order_id, NOW])).rows[0].r).toBe("REFUND_RECORDED");
    expect((await row("payments", p2.paymentId)).status).toBe("REFUNDED");
    expect((await row("orders", o2.order_id)).status).toBe("CANCELLED");
    expect((await pool.query("select count(*) from audit_events where event_type = 'reconciliation_resolved' and actor_id = $1", [admin])).rows[0].count).toBe("2");
  });

  it("periode tahunan dihitung dari awal tanpa menyusut (mulai tanggal 31)", async () => {
    const admin = await kit.admin();
    await pool.query("select set_price($1, 'MEMBERSHIP_ANNUAL', 'DEFAULT', 190000, null, null)", [admin]);
    const u = await createUser(pool);
    const start = new Date("2026-01-31T05:00:00Z");
    const o = await kit.order(u, "MEMBERSHIP_ANNUAL", null, start);
    const p = await kit.pay(u, o.order_id, "mock", start);
    await kit.settle("mock", p.ref, o.amount_idr, start);
    const ms = (await pool.query("select period_end from memberships where user_id = $1 order by period_start", [u])).rows;
    expect(ms[11].period_end.toISOString()).toBe("2027-01-31T05:00:00.000Z");
  });
});

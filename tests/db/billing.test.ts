import { afterAll, describe, expect, it } from "vitest";
import { PRICING } from "@/lib/pricing/catalog";
import { asUser, createUser, getPool } from "./helpers";
import { at, makeKit, NOW } from "./phase3-helpers";

const pool = getPool();
afterAll(() => pool.end());
const kit = makeKit(pool);
const cat = async () => Object.fromEntries((await pool.query("select kind || '/' || variant as k, amount_idr from price_catalog")).rows.map((r) => [r.k, r.amount_idr]));

describe("katalog harga", () => {
  it("seed terkunci sama dengan PRICING", async () => {
    const c = await cat();
    expect(c["STANDARD_REVIEW/FREE"]).toBe(PRICING.standard.free);
    expect(c["STANDARD_REVIEW/MEMBER_FIRST"]).toBe(PRICING.standard.memberFirst);
    expect(c["STANDARD_REVIEW/MEMBER_LATER"]).toBe(PRICING.standard.memberLater);
    expect(c["MEMBERSHIP_MONTHLY/DEFAULT"]).toBe(PRICING.membershipMonthlyIdr);
    expect(c["MEMBERSHIP_ANNUAL/DEFAULT"]).toBeUndefined();
    expect(c["BUNDLE/DEFAULT"]).toBeUndefined();
  });
});

describe("order dan harga review standar", () => {
  it("Free → Rp50.000 tanpa entitlement", async () => {
    const u = await createUser(pool);
    const v = await kit.frozen(u);
    const o = await kit.order(u, "STANDARD_REVIEW", v.versionId);
    expect([o.amount_idr, o.status]).toEqual([50000, "PENDING_PAYMENT"]);
    expect((await pool.query("select count(*) from review_discount_entitlements where order_id = $1", [o.order_id])).rows[0].count).toBe("0");
  });

  it("Member aktif: pertama Rp30.000 (RESERVED), berikutnya Rp35.000 dalam periode yang sama", async () => {
    const u = await kit.member();
    const v1 = await kit.frozen(u);
    const v2 = await kit.frozen(u);
    const a = await kit.order(u, "STANDARD_REVIEW", v1.versionId);
    const b = await kit.order(u, "STANDARD_REVIEW", v2.versionId);
    expect([a.amount_idr, b.amount_idr]).toEqual([30000, 35000]);
    expect((await pool.query("select status from review_discount_entitlements where order_id = $1", [a.order_id])).rows[0].status).toBe("RESERVED");
  });

  it("dua order serentak oleh Member untuk periode yang sama: tepat satu Rp30.000", async () => {
    const u = await kit.member();
    const [v1, v2] = [await kit.frozen(u), await kit.frozen(u)];
    const rs = await Promise.all([kit.order(u, "STANDARD_REVIEW", v1.versionId), kit.order(u, "STANDARD_REVIEW", v2.versionId)]);
    expect(rs.map((r) => r.amount_idr).sort()).toEqual([30000, 35000]);
  });

  it("periode membership baru mendapat harga pertama lagi", async () => {
    const u = await kit.member("2026-10-01", "2026-11-01");
    await pool.query("insert into memberships(user_id, status, period_start, period_end) values ($1, 'ACTIVE', '2026-11-01', '2026-12-01')", [u]);
    const v1 = await kit.frozen(u);
    const v2 = await kit.frozen(u);
    expect((await kit.order(u, "STANDARD_REVIEW", v1.versionId)).amount_idr).toBe(30000);
    expect((await kit.order(u, "STANDARD_REVIEW", v2.versionId, at(40 * 24 * 60))).amount_idr).toBe(30000);
  });

  it("expire_orders setelah 24 jam melepas entitlement; order berikutnya kembali Rp30.000", async () => {
    const u = await kit.member("2026-10-01", "2026-12-01");
    const v1 = await kit.frozen(u);
    const v2 = await kit.frozen(u);
    const a = await kit.order(u, "STANDARD_REVIEW", v1.versionId);
    expect((await pool.query("select expire_orders($1) as n", [at(23 * 60)])).rows[0].n).toBe(0);
    expect((await pool.query("select expire_orders($1) as n", [at(25 * 60)])).rows[0].n).toBeGreaterThanOrEqual(1);
    expect((await pool.query("select status from orders where id = $1", [a.order_id])).rows[0].status).toBe("EXPIRED");
    expect((await pool.query("select status from review_discount_entitlements where order_id = $1", [a.order_id])).rows[0].status).toBe("RELEASED");
    expect((await kit.order(u, "STANDARD_REVIEW", v2.versionId, at(26 * 60))).amount_idr).toBe(30000);
  });

  it("kunci idempoten sama → order sama dan duplicate=true", async () => {
    const u = await createUser(pool);
    const v = await kit.frozen(u);
    const k = "idem-key-123456";
    const a = await kit.order(u, "STANDARD_REVIEW", v.versionId, NOW, k);
    const b = await kit.order(u, "STANDARD_REVIEW", v.versionId, NOW, k);
    expect([b.order_id, b.duplicate]).toEqual([a.order_id, true]);
  });

  it("versi orang lain → NOT_FOUND; versi yang sudah punya order aktif → ALREADY_REVIEWED", async () => {
    const owner = await createUser(pool);
    const other = await createUser(pool);
    const v = await kit.frozen(owner);
    await expect(kit.order(other, "STANDARD_REVIEW", v.versionId)).rejects.toThrow(/NOT_FOUND/);
    await kit.order(owner, "STANDARD_REVIEW", v.versionId);
    await expect(kit.order(owner, "STANDARD_REVIEW", v.versionId)).rejects.toThrow(/ALREADY_REVIEWED/);
  });

  it("order yang kedaluwarsa membuka kembali versi untuk dipesan", async () => {
    const owner = await createUser(pool);
    const v = await kit.frozen(owner);
    await kit.order(owner, "STANDARD_REVIEW", v.versionId);
    await expect(kit.order(owner, "STANDARD_REVIEW", v.versionId, at(25 * 60))).resolves.toBeTruthy();
  });

  it("kredit AVAILABLE → order Rp0 langsung PAID tanpa menyentuh entitlement diskon", async () => {
    const u = await kit.member();
    const v = await kit.frozen(u);
    const ord = await pool.query("insert into orders(user_id, kind, status, amount_idr, price_snapshot, idempotency_key, expires_at) values ($1, 'BUNDLE', 'PAID', 1, '{}', $2, $3) returning id", [u, `seed-${Math.random()}`, at(60)]);
    await pool.query("insert into review_credits(user_id, order_id, expires_at, status) values ($1, $2, $3, 'AVAILABLE')", [u, ord.rows[0].id, "2027-01-01"]);
    const o = await kit.order(u, "STANDARD_REVIEW", v.versionId);
    expect([o.amount_idr, o.status]).toEqual([0, "PAID"]);
    expect((await pool.query("select count(*) from review_discount_entitlements where order_id = $1", [o.order_id])).rows[0].count).toBe("0");
    expect((await pool.query("select status from review_credits where user_id = $1", [u])).rows[0].status).toBe("CONSUMED");
  });
});

describe("produk dengan harga UNKNOWN", () => {
  it("MEMBERSHIP_ANNUAL dan BUNDLE tidak dapat dipesan sampai admin mengisi harga", async () => {
    const u = await createUser(pool);
    await expect(kit.order(u, "MEMBERSHIP_ANNUAL", null)).rejects.toThrow(/PRODUCT_UNAVAILABLE/);
    await expect(kit.order(u, "BUNDLE", null)).rejects.toThrow(/PRODUCT_UNAVAILABLE/);
    const admin = await kit.admin();
    await pool.query("select set_price($1, 'MEMBERSHIP_ANNUAL', 'DEFAULT', 190000, null, null)", [admin]);
    await pool.query("select set_price($1, 'BUNDLE', 'DEFAULT', 100000, 3, 90)", [admin]);
    expect((await kit.order(u, "MEMBERSHIP_ANNUAL", null)).amount_idr).toBe(190000);
    expect((await kit.order(u, "BUNDLE", null)).amount_idr).toBe(100000);
    expect((await pool.query("select count(*) from audit_events where event_type = 'price_set' and actor_id = $1", [admin])).rows[0].count).toBe("2");
  });

  it("set_price oleh non-admin FORBIDDEN; harga review terkunci tidak dapat diubah; BUNDLE wajib kredit", async () => {
    const u = await createUser(pool);
    await expect(pool.query("select set_price($1, 'BUNDLE', 'DEFAULT', 100000, 3, 90)", [u])).rejects.toThrow(/FORBIDDEN/);
    const admin = await kit.admin();
    await expect(pool.query("select set_price($1, 'STANDARD_REVIEW', 'FREE', 1, null, null)", [admin])).rejects.toThrow(/PRICE_LOCKED/);
    await expect(pool.query("select set_price($1, 'BUNDLE', 'DEFAULT', 100000, null, null)", [admin])).rejects.toThrow(/INVALID_BUNDLE/);
  });
});

describe("akses klien", () => {
  it("authenticated tidak dapat memanggil fungsi atau membaca tabel penagihan", async () => {
    const u = await createUser(pool);
    await expect(asUser(pool, u, (c) => c.query("select * from create_order($1, 'MEMBERSHIP_MONTHLY', null, 'k-123456789', now())", [u]))).rejects.toThrow(/permission denied/);
    await expect(asUser(pool, u, (c) => c.query("select * from orders"))).rejects.toThrow(/permission denied/);
    await expect(asUser(pool, u, (c) => c.query("select * from price_catalog"))).rejects.toThrow(/permission denied/);
  });
});

import { afterAll, describe, expect, it } from "vitest";
import { PRICING } from "@/lib/pricing/catalog";
import { asUser, createUser, getPool } from "./helpers";
import { at, makeKit, NOW } from "./phase3-helpers";

const pool = getPool();
afterAll(() => pool.end());
const kit = makeKit(pool);
const elig = async (u: string, parent: string, now: Date = NOW) => (await pool.query("select * from deep_eligibility($1, $2, $3)", [u, parent, now])).rows[0] as { eligible: boolean; reason: string };

describe("harga deep", () => {
  it("katalog sama dengan PRICING; Free Rp200.000, Member aktif Rp150.000, tanpa diskon pertama", async () => {
    const c = (await pool.query("select variant, amount_idr from price_catalog where kind = 'DEEP_REVIEW'")).rows;
    expect(Object.fromEntries(c.map((r) => [r.variant, r.amount_idr]))).toEqual({ FREE: PRICING.deepAdditional.free, MEMBER: PRICING.deepAdditional.member });
    const free = await kit.completedStandard();
    expect((await kit.order(free.owner, "DEEP_REVIEW", free.req)).amount_idr).toBe(200000);
    const mem = await kit.completedStandard({ member: true });
    const o = await kit.order(mem.owner, "DEEP_REVIEW", mem.req);
    expect(o.amount_idr).toBe(150000);
    expect((await pool.query("select count(*) from review_discount_entitlements where order_id = $1", [o.order_id])).rows[0].count).toBe("0");
    expect((await pool.query("select price_snapshot from orders where id = $1", [o.order_id])).rows[0].price_snapshot).toMatchObject({ variant: "MEMBER", parent_request_id: mem.req });
  });
});

describe("kelayakan (policy vectors)", () => {
  it("layak: standar selesai, catatan aktionabel, induk aktif, hash sama", async () => {
    const c = await kit.completedStandard();
    expect(await elig(c.owner, c.req)).toEqual({ eligible: true, reason: "OK" });
  });

  it("standar belum selesai (IN_REVIEW) → tidak layak", async () => {
    await pool.query("update firms set is_default = false");
    const f = await kit.firm({ isDefault: true });
    const r = await f.addReviewer();
    const u = await createUser(pool);
    const v = await kit.frozen(u);
    const b = await kit.buy(u, "STANDARD_REVIEW", v.versionId);
    const req = (await pool.query("select id from review_requests where order_id = $1", [b.order_id])).rows[0].id;
    await pool.query("select assign_review($1, $2, $3, $4)", [f.coordinator, req, r.reviewer, NOW]);
    await pool.query("select * from start_review($1, $2, $3)", [r.reviewer, req, NOW]);
    expect((await elig(u, req)).reason).toBe("PARENT_NOT_COMPLETED");
    await expect(kit.order(u, "DEEP_REVIEW", req)).rejects.toThrow(/NOT_ELIGIBLE: PARENT_NOT_COMPLETED/);
  });

  it("tanpa catatan aktionabel atau hanya informasi → tidak layak", async () => {
    const minor = await kit.completedStandard({ severity: "MINOR", actionable: false });
    expect((await elig(minor.owner, minor.req)).reason).toBe("NO_ACTIONABLE_NOTES");
    await expect(kit.order(minor.owner, "DEEP_REVIEW", minor.req)).rejects.toThrow(/NO_ACTIONABLE_NOTES/);
  });

  it("verifikasi induk dicabut → tidak layak", async () => {
    const c = await kit.completedStandard();
    await pool.query("select revoke_verification($1, $2, 'ERROR', null, $3)", [c.f.admin, c.verificationId, NOW]);
    expect((await elig(c.owner, c.req)).reason).toBe("PARENT_NOT_ACTIVE");
  });

  it("hash versi tidak cocok → tidak layak", async () => {
    const c = await kit.completedStandard();
    await pool.query("update review_requests set version_sha256 = $2 where id = $1", [c.req, "d".repeat(64)]);
    expect((await elig(c.owner, c.req)).reason).toBe("VERSION_MISMATCH");
  });

  it("induk selesai tanpa catatan (WITHIN_SCOPE) → alasan NO_ACTIONABLE_NOTES, bukan 'belum selesai'", async () => {
    const c = await kit.completedStandard({ noNotes: true });
    expect((await elig(c.owner, c.req)).reason).toBe("NO_ACTIONABLE_NOTES");
  });

  it("pemilik lain atau induk tak ada → NOT_FOUND", async () => {
    const c = await kit.completedStandard();
    expect((await elig(await createUser(pool), c.req)).reason).toBe("NOT_FOUND");
    await expect(kit.order(await createUser(pool), "DEEP_REVIEW", c.req)).rejects.toThrow(/NOT_FOUND/);
    await expect(kit.order(c.owner, "DEEP_REVIEW", "00000000-0000-4000-8000-000000000000")).rejects.toThrow(/NOT_FOUND/);
  });
});

describe("order deep", () => {
  it("dua order serentak untuk induk yang sama: tepat satu berhasil, satu DEEP_EXISTS", async () => {
    const c = await kit.completedStandard();
    const rs = await Promise.allSettled([kit.order(c.owner, "DEEP_REVIEW", c.req), kit.order(c.owner, "DEEP_REVIEW", c.req)]);
    expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const bad = rs.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(String(bad.reason)).toMatch(/DEEP_EXISTS/);
  });

  it("order kedaluwarsa membuka kembali; kunci idempoten sama → order sama", async () => {
    const c = await kit.completedStandard();
    const a = await kit.order(c.owner, "DEEP_REVIEW", c.req, NOW, "idem-deep-12345678");
    expect((await kit.order(c.owner, "DEEP_REVIEW", c.req, NOW, "idem-deep-12345678")).order_id).toBe(a.order_id);
    await expect(kit.order(c.owner, "DEEP_REVIEW", c.req, at(60))).rejects.toThrow(/DEEP_EXISTS/);
    const b = await kit.order(c.owner, "DEEP_REVIEW", c.req, at(25 * 60));
    expect(b.order_id).not.toBe(a.order_id);
  });

  it("pembayaran tepat waktu untuk order lama yang sudah diganti order baru tidak melempar: dicatat sebagai rekonsiliasi", async () => {
    const c = await kit.completedStandard();
    const a = await kit.order(c.owner, "DEEP_REVIEW", c.req);
    const pa = await kit.pay(c.owner, a.order_id);
    const b = await kit.order(c.owner, "DEEP_REVIEW", c.req, at(25 * 60));
    expect(b.order_id).not.toBe(a.order_id);
    const r = (await pool.query("select settle_payment('mock', $1, 'ev-late', $2, 0, $3, $4) as r", [pa.ref, a.amount_idr, at(26 * 60), at(60)])).rows[0].r;
    expect(r).toBe("RECONCILIATION_REQUIRED");
    expect((await pool.query("select status from orders where id = $1", [a.order_id])).rows[0].status).toBe("RECONCILIATION_REQUIRED");
    expect((await pool.query("select count(*) from deep_requests where parent_request_id = $1", [c.req])).rows[0].count).toBe("0");
  });

  it("harga dari plan saat order: Member yang kedaluwarsa membayar Rp200.000 pada order baru", async () => {
    const c = await kit.completedStandard({ member: true });
    expect((await kit.order(c.owner, "DEEP_REVIEW", c.req, NOW)).amount_idr).toBe(150000);
    await pool.query("update memberships set period_end = $2 where user_id = $1", [c.owner, "2026-10-17"]);
    expect((await kit.order(c.owner, "DEEP_REVIEW", c.req, at(25 * 60))).amount_idr).toBe(200000);
  });

  it("authenticated tidak dapat memanggil deep_eligibility atau membaca tabel deep", async () => {
    const u = await createUser(pool);
    await expect(asUser(pool, u, (c) => c.query("select * from deep_eligibility($1, $1, now())", [u]))).rejects.toThrow(/permission denied/);
    await expect(asUser(pool, u, (c) => c.query("select * from deep_requests"))).rejects.toThrow(/permission denied/);
  });
});

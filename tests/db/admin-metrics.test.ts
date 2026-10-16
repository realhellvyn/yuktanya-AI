import { afterAll, describe, expect, it } from "vitest";
import { asUser, createUser, getPool } from "./helpers";
import { at, makeKit, NOW } from "./phase3-helpers";

const pool = getPool();
afterAll(() => pool.end());
const kit = makeKit(pool);
type Overview = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const overview = async (admin: string, from: Date, to: Date): Promise<Overview> => (await pool.query("select admin_overview($1, $2, $3) as o", [admin, from, to])).rows[0].o;
// Rentang sehari WIB 16 Oktober 2026 (00:00 WIB = 17:00Z hari sebelumnya).
const DAY_FROM = new Date("2026-10-15T17:00:00Z");
const DAY_TO = new Date("2026-10-16T17:00:00Z");
const collected = (o: Overview) => o.revenue?.collected ?? 0;
const kindSum = (o: Overview, k: string) => o.revenue?.collected_by_kind?.[k] ?? 0;

describe("admin_overview", () => {
  it("non-admin FORBIDDEN dan klien tidak dapat memanggil", async () => {
    const u = await createUser(pool);
    await expect(overview(u, DAY_FROM, DAY_TO)).rejects.toThrow(/FORBIDDEN/);
    await expect(asUser(pool, u, (c) => c.query("select admin_overview($1, now(), now())", [u]))).rejects.toThrow(/permission denied/);
  });

  it("pendapatan hanya dari pembayaran VERIFIED: order tanpa bayar, DISPUTED, dan kredit tidak dihitung; pembagian per jenis menjumlah ke total", async () => {
    const admin = await kit.admin();
    const before = await overview(admin, DAY_FROM, DAY_TO);
    const u = await createUser(pool);
    await kit.order(u, "MEMBERSHIP_MONTHLY", null); // tidak dibayar
    const o2 = await kit.order(u, "MEMBERSHIP_MONTHLY", null);
    const p2 = await kit.pay(u, o2.order_id);
    await kit.settle("mock", p2.ref, 5); // jumlah salah → DISPUTED
    const mid = await overview(admin, DAY_FROM, DAY_TO);
    expect(collected(mid)).toBe(collected(before));
    const v = await kit.frozen(u);
    const b = await kit.buy(u, "STANDARD_REVIEW", v.versionId);
    const m = await kit.order(u, "MEMBERSHIP_MONTHLY", null);
    const pm = await kit.pay(u, m.order_id);
    await kit.settle("mock", pm.ref, 19000, NOW, "ev-metrics", 700);
    const after = await overview(admin, DAY_FROM, DAY_TO);
    expect(b.settled).toBe("SETTLED");
    expect(collected(after) - collected(before)).toBe(50000 + 19000);
    expect(kindSum(after, "MEMBERSHIP_MONTHLY") - kindSum(before, "MEMBERSHIP_MONTHLY")).toBe(19000);
    expect(kindSum(after, "STANDARD_REVIEW") - kindSum(before, "STANDARD_REVIEW")).toBe(50000);
    expect((after.revenue.fees ?? 0) - (before.revenue?.fees ?? 0)).toBe(700);
    const parts = Object.values(after.revenue.collected_by_kind as Record<string, number>).reduce((a, b2) => a + b2, 0);
    expect(parts).toBe(after.revenue.collected);
    expect(after.revenue.net).toBe(after.revenue.collected - after.revenue.refunds);
  });

  it("batas rentang WIB: 23.59 WIB masuk, 00.00 WIB hari berikutnya tidak (akhir eksklusif)", async () => {
    const admin = await kit.admin();
    const before = await overview(admin, DAY_FROM, DAY_TO);
    const inside = new Date("2026-10-16T16:59:00Z");
    const edge = new Date("2026-10-16T17:00:00Z");
    for (const when of [inside, edge]) {
      const u = await createUser(pool);
      const o = await kit.order(u, "MEMBERSHIP_MONTHLY", null, when);
      const p = await kit.pay(u, o.order_id, "mock", when);
      await kit.settle("mock", p.ref, 19000, when);
    }
    const after = await overview(admin, DAY_FROM, DAY_TO);
    expect(collected(after) - collected(before)).toBe(19000);
  });

  it("tanpa data: AI, SLA, dan pendapatan null pada rentang kosong (bukan nol karangan)", async () => {
    const admin = await kit.admin();
    const o = await overview(admin, new Date("2031-01-01T00:00:00Z"), new Date("2031-01-08T00:00:00Z"));
    expect(o.revenue).toBeNull();
    expect(o.reviews.sla_median_hours).toBeNull();
    expect(o.reviews.sla_p95_hours).toBeNull();
    if (o.ai !== null) {
      expect(o.ai.p50_ms).toBeNull();
      expect(o.ai.success_rate).toBeNull();
    }
  });

  it("latensi AI dari product_events dan tingkat keberhasilan", async () => {
    const admin = await kit.admin();
    const u = await createUser(pool);
    const t0 = new Date("2030-06-01T05:00:00Z");
    const ev = async (name: string, ms: number | null, i: number) => pool.query(
      "insert into product_events (actor_user_id, event_name, dedupe_key, occurred_at, metadata_safe) values ($1, $2, $3, $4, $5)",
      [u, name, `m-${Math.random()}-${i}`, t0, JSON.stringify(ms === null ? {} : { latency_ms: ms })]);
    for (const [i, ms] of [100, 200, 300, 400, 500].entries()) await ev("ai_request_succeeded", ms, i);
    await ev("ai_request_failed", null, 9);
    const o = await overview(admin, new Date("2030-06-01T00:00:00Z"), new Date("2030-06-02T00:00:00Z"));
    expect(o.ai).toMatchObject({ requests: 6, succeeded: 5, failed: 1, p50_ms: 300 });
    expect(Number(o.ai.success_rate)).toBeCloseTo(5 / 6, 3);
    expect(o.incidents.ai_failures).toBe(1);
  });

  it("antrean review: usia dan jumlah belum ditugaskan naik; SLA terisi setelah selesai; tidak ada isi dokumen di hasil", async () => {
    const admin = await kit.admin();
    const to = new Date(Date.now() + 3_600_000);
    const from = new Date(Date.now() - 86_400_000 * 2);
    const before = await overview(admin, from, to);
    await pool.query("update firms set is_default = false");
    const f = await kit.firm({ isDefault: true });
    const u = await createUser(pool);
    const v = await kit.frozen(u);
    await kit.buy(u, "STANDARD_REVIEW", v.versionId);
    const mid = await overview(admin, from, to);
    expect(mid.reviews.unassigned - before.reviews.unassigned).toBe(1);
    expect(mid.reviews.backlog_by_age.lt_24h - before.reviews.backlog_by_age.lt_24h).toBe(1);
    void f;
    const done = await kit.completedStandard();
    const after = await overview(admin, DAY_FROM, DAY_TO);
    expect(done.req).toBeTruthy();
    expect(after.reviews.sla_median_hours).not.toBeNull();
    expect(JSON.stringify(after)).not.toMatch(/ZZ-RAHASIA|Sinta Dewi|Budi Santoso/);
  });

  it("funnel kohort menghitung pengguna unik", async () => {
    const admin = await kit.admin();
    const from = new Date(Date.now() - 60_000);
    const to = new Date(Date.now() + 3_600_000);
    const before = await overview(admin, from, to);
    const u = await createUser(pool);
    const v1 = await kit.frozen(u);
    await kit.order(u, "STANDARD_REVIEW", v1.versionId);
    const after = await overview(admin, from, to);
    expect(after.funnel.registered - before.funnel.registered).toBe(1);
    expect(after.funnel.doc_started - before.funnel.doc_started).toBe(1);
    expect(after.funnel.version_created - before.funnel.version_created).toBe(1);
    expect(after.funnel.review_requested - before.funnel.review_requested).toBe(1);
    expect(after.funnel.review_paid - before.funnel.review_paid).toBe(0);
  });
});

describe("admin_find_user dan admin_list_partners", () => {
  it("hanya admin; email tidak peka huruf besar; mitra terdaftar tampil dengan otorisasi", async () => {
    const f = await kit.firm();
    const r = await f.addReviewer();
    const email = (await pool.query("select email from auth.users where id = $1", [r.reviewer])).rows[0].email as string;
    await expect(pool.query("select admin_find_user($1, $2)", [r.reviewer, email])).rejects.toThrow(/FORBIDDEN/);
    expect((await pool.query("select admin_find_user($1, $2) as id", [f.admin, email.toUpperCase()])).rows[0].id).toBe(r.reviewer);
    expect((await pool.query("select admin_find_user($1, 'tidak@ada.test') as id", [f.admin])).rows[0].id).toBeNull();
    const rows = (await pool.query("select * from admin_list_partners($1)", [f.admin])).rows;
    expect(rows.some((x) => x.user_id === r.reviewer && x.email === email && x.authorization_id === r.authId && x.revoked_at === null)).toBe(true);
    await expect(pool.query("select * from admin_list_partners($1)", [r.reviewer])).rejects.toThrow(/FORBIDDEN/);
    void at;
  });
});

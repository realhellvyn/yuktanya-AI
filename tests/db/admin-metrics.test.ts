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

describe("keadilan angka (hasil review)", () => {
  const WIDE_FROM = new Date("2026-10-15T17:00:00Z");
  const WIDE_TO = new Date("2026-10-19T00:00:00Z");
  it("uang yang pernah terverifikasi tetap dihitung setelah ditahan; refund tidak dikurangkan dua kali; refund dari transfer yang tak pernah terverifikasi tidak masuk", async () => {
    const admin = await kit.admin();
    const before = await overview(admin, WIDE_FROM, WIDE_TO);
    const c = await kit.completedStandard();
    const b = await kit.buy(c.owner, "DEEP_REVIEW", c.req);
    const mid = await overview(admin, WIDE_FROM, WIDE_TO);
    await pool.query("select revoke_verification($1, $2, 'ERROR', null, $3)", [c.f.admin, c.verificationId, NOW]);
    const held = await overview(admin, WIDE_FROM, WIDE_TO);
    expect(collected(held)).toBe(collected(mid));
    expect(held.revenue.held - (mid.revenue.held ?? 0)).toBe(200000);
    await pool.query("select admin_resolve_reconciliation($1, $2, 'REFUND_RECORDED', 'dikembalikan via bank', $3)", [c.f.admin, b.order_id, NOW]);
    const refunded = await overview(admin, WIDE_FROM, WIDE_TO);
    expect(refunded.revenue.refunds - (mid.revenue.refunds ?? 0)).toBe(200000);
    expect(refunded.revenue.net - (mid.revenue.net ?? 0)).toBe(-200000);
    expect(collected(refunded)).toBe(collected(mid));
    // transfer tak cocok (tak pernah terverifikasi) lalu dikembalikan: bukan pendapatan, bukan pengurang
    const u = await createUser(pool);
    const o = await kit.order(u, "MEMBERSHIP_MONTHLY", null);
    const p = await kit.pay(u, o.order_id);
    await kit.settle("mock", p.ref, 5000);
    await pool.query("select admin_resolve_reconciliation($1, $2, 'REFUND_RECORDED', 'dikembalikan via bank', $3)", [admin, o.order_id, NOW]);
    const after = await overview(admin, WIDE_FROM, WIDE_TO);
    expect(after.revenue.refunds).toBe(refunded.revenue.refunds);
    expect(after.revenue.net).toBe(refunded.revenue.net);
    void before;
  });

  it("usia antrean dihitung dari sekarang, bukan dari akhir rentang", async () => {
    const admin = await kit.admin();
    const to = new Date(Date.now() + 20 * 3_600_000);
    const from = new Date(Date.now() - 86_400_000);
    const before = await overview(admin, from, to);
    const c = await kit.completedStandard({ noNotes: true });
    void c;
    await pool.query("update firms set is_default = false");
    const f = await kit.firm({ isDefault: true });
    void f;
    const u = await createUser(pool);
    const v = await kit.frozen(u);
    const b = await kit.buy(u, "STANDARD_REVIEW", v.versionId);
    await pool.query("update review_requests set created_at = now() - interval '11 hours' where order_id = $1", [b.order_id]);
    const after = await overview(admin, from, to);
    expect(after.reviews.backlog_by_age.lt_24h - before.reviews.backlog_by_age.lt_24h).toBe(1);
    expect(after.reviews.backlog_by_age.d1_3 - before.reviews.backlog_by_age.d1_3).toBe(0);
  });

  it("Member aktif tetap terhitung walau tidak ada pembayaran pada rentang", async () => {
    const admin = await kit.admin();
    await kit.member("2026-01-01", "2031-01-01");
    const o = await overview(admin, new Date("2030-01-01T00:00:00Z"), new Date("2030-01-02T00:00:00Z"));
    expect(o.revenue).toBeNull();
    expect(o.members.active).toBeGreaterThanOrEqual(1);
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

describe("admin_analytics (tren harian, filter, kualitas, peringatan)", () => {
  type A = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const analytics = async (admin: string, from: Date, to: Date, cat: string | null = null, mem: string | null = null): Promise<A> =>
    (await pool.query("select admin_analytics($1, $2, $3, $4, $5) as a", [admin, from, to, cat, mem])).rows[0].a;
  // 1–2 Maret 2032 WIB
  const D1 = new Date("2032-02-29T17:00:00Z");
  const D2 = new Date("2032-03-01T17:00:00Z");
  const D3 = new Date("2032-03-02T17:00:00Z");
  const newDoc = async (u: string, cat: string, when: Date) => {
    const { documentId } = await kit.docs.create(u, cat as never, `k-${Math.random()}`);
    await pool.query("update documents set created_at = $2 where id = $1", [documentId, when]);
    return documentId;
  };

  it("hanya admin; filter dan rentang divalidasi di DB", async () => {
    const u = await createUser(pool);
    const admin = await kit.admin();
    await expect(analytics(u, D1, D2)).rejects.toThrow(/FORBIDDEN/);
    await expect(asUser(pool, u, (c) => c.query("select admin_analytics($1, now(), now(), null, null)", [u]))).rejects.toThrow(/permission denied/);
    await expect(analytics(admin, D1, D2, "RAHASIA")).rejects.toThrow(/INVALID_FILTER/);
    await expect(analytics(admin, D1, D2, null, "ADMIN")).rejects.toThrow(/INVALID_FILTER/);
    await expect(analytics(admin, D2, D1)).rejects.toThrow(/INVALID_RANGE/);
    await expect(analytics(admin, new Date("2030-01-01T00:00:00Z"), new Date("2032-01-01T00:00:00Z"))).rejects.toThrow(/INVALID_RANGE/);
  });

  it("seri harian berbatas WIB: 23.59 WIB masuk hari itu, 00.00 WIB masuk hari berikutnya; total = jumlah seri", async () => {
    const admin = await kit.admin();
    const before = await analytics(admin, D1, D3);
    const u = await createUser(pool);
    await newDoc(u, "NDA", new Date("2032-03-01T16:59:00Z"));
    await newDoc(u, "NDA", new Date("2032-03-01T17:00:00Z"));
    const a = await analytics(admin, D1, D3);
    expect(a.days).toEqual(["2032-03-01", "2032-03-02"]);
    expect(a.series.docs_started[0] - before.series.docs_started[0]).toBe(1);
    expect(a.series.docs_started[1] - before.series.docs_started[1]).toBe(1);
    for (const [k, s] of Object.entries(a.series as Record<string, number[] | null>)) {
      if (s) expect(s.reduce((x, y) => x + y, 0), k).toBe(a.totals[k]);
    }
    const one = await analytics(admin, D1, D2);
    expect(one.days).toEqual(["2032-03-01"]);
  });

  it("filter jenis dokumen dan keanggotaan mengubah angka; metrik pengguna/AI tidak berlaku untuk filter jenis (null, bukan nol)", async () => {
    const admin = await kit.admin();
    const b = { all: await analytics(admin, D1, D3), nda: await analytics(admin, D1, D3, "NDA"), pks: await analytics(admin, D1, D3, "PKS"),
      member: await analytics(admin, D1, D3, null, "MEMBER"), free: await analytics(admin, D1, D3, null, "FREE") };
    const free = await createUser(pool);
    const member = await kit.member("2032-01-01", "2032-12-31");
    await newDoc(free, "PKS", new Date("2032-03-01T03:00:00Z"));
    await newDoc(member, "NDA", new Date("2032-03-01T03:00:00Z"));
    await newDoc(member, "NDA", new Date("2032-03-02T03:00:00Z"));
    const d = async (cat: string | null, mem: string | null, base: A) => (await analytics(admin, D1, D3, cat, mem)).totals.docs_started - base.totals.docs_started;
    expect(await d(null, null, b.all)).toBe(3);
    expect(await d("NDA", null, b.nda)).toBe(2);
    expect(await d("PKS", null, b.pks)).toBe(1);
    expect(await d(null, "MEMBER", b.member)).toBe(2);
    expect(await d(null, "FREE", b.free)).toBe(1);
    const nda = await analytics(admin, D1, D3, "NDA");
    expect(nda.series.new_users).toBeNull();
    expect(nda.totals.new_users).toBeNull();
    expect(nda.series.ai_messages).toBeNull();
  });

  it("angka dari tabel sumber, bukan event: event palsu tidak menambah pendapatan/review dibayar; pendapatan ikut filter jenis", async () => {
    const admin = await kit.admin();
    const W1 = new Date(NOW.getTime() - 86_400_000);
    const W2 = new Date(NOW.getTime() + 86_400_000);
    const before = await analytics(admin, W1, W2);
    await pool.query("insert into product_events (event_name, entity_id, dedupe_key, occurred_at, metadata_safe) values ('review_payment_verified', 'palsu', $1, $2, '{\"amount_idr\": 999999}')", [`palsu-${Math.random()}`, NOW]);
    const mid = await analytics(admin, W1, W2);
    expect(mid.totals.revenue).toBe(before.totals.revenue);
    expect(mid.totals.reviews_paid).toBe(before.totals.reviews_paid);
    const beforeNda = await analytics(admin, W1, W2, "NDA");
    const beforePks = await analytics(admin, W1, W2, "PKS");
    const u = await createUser(pool);
    const v = await kit.frozen(u);
    await kit.buy(u, "STANDARD_REVIEW", v.versionId);
    const m = await kit.order(u, "MEMBERSHIP_MONTHLY", null);
    const pm = await kit.pay(u, m.order_id);
    await kit.settle("mock", pm.ref, 19000);
    const after = await analytics(admin, W1, W2);
    expect(after.totals.revenue - before.totals.revenue).toBe(50000 + 19000);
    expect(after.totals.reviews_paid - before.totals.reviews_paid).toBe(1);
    expect(after.totals.reviews_requested - before.totals.reviews_requested).toBe(1);
    expect((await analytics(admin, W1, W2, "NDA")).totals.revenue - beforeNda.totals.revenue).toBe(50000);
    expect((await analytics(admin, W1, W2, "PKS")).totals.revenue - beforePks.totals.revenue).toBe(0);
  });

  it("panel kualitas: hasil review per jenis, catatan terbit, verifikasi terbit/dicabut, keluaran AI rusak; keluhan tanpa sumber = null", async () => {
    const admin = await kit.admin();
    const W1 = new Date(NOW.getTime() - 86_400_000);
    const W2 = new Date(NOW.getTime() + 86_400_000);
    const before = (await analytics(admin, W1, W2)).quality;
    const c = await kit.completedStandard();
    await kit.completedStandard({ noNotes: true });
    await pool.query("select revoke_verification($1, $2, 'ERROR', null, $3)", [c.f.admin, c.verificationId, NOW]);
    await pool.query("insert into product_events (actor_user_id, event_name, dedupe_key, occurred_at, metadata_safe) values ($1, 'ai_request_failed', $2, $3, '{\"error_code\": \"MALFORMED_OUTPUT\"}')", [c.owner, `mal-${Math.random()}`, NOW]);
    const q = (await analytics(admin, W1, W2)).quality;
    expect(q.reviews_by_outcome.WITH_NOTES - (before.reviews_by_outcome.WITH_NOTES ?? 0)).toBe(1);
    expect(q.reviews_by_outcome.WITHIN_SCOPE - (before.reviews_by_outcome.WITHIN_SCOPE ?? 0)).toBe(1);
    expect(q.legal_notes_published - before.legal_notes_published).toBe(1);
    expect(q.verifications_issued.LEGAL - (before.verifications_issued.LEGAL ?? 0)).toBe(2);
    expect(q.verifications_revoked - before.verifications_revoked).toBe(1);
    expect(q.ai_malformed - (before.ai_malformed ?? 0)).toBe(1);
    expect(q.complaints).toBeNull();
  });

  it("peringatan: antrean review melewati ambang jam, galat AI 24 jam, bayar tetapi belum masuk antrean", async () => {
    const admin = await kit.admin();
    const before = (await analytics(admin, D1, D2)).alerts;
    expect(before.overdue_hours).toBe(72);
    await pool.query("update firms set is_default = false");
    await kit.firm({ isDefault: true });
    const u = await createUser(pool);
    const v = await kit.frozen(u);
    const b = await kit.buy(u, "STANDARD_REVIEW", v.versionId);
    await pool.query("update review_requests set created_at = now() - interval '73 hours' where order_id = $1", [b.order_id]);
    for (let i = 0; i < 3; i++) {
      await pool.query("insert into product_events (actor_user_id, event_name, dedupe_key, occurred_at) values ($1, 'ai_request_failed', $2, now())", [u, `al-${Math.random()}`]);
    }
    const a = (await analytics(admin, D1, D2)).alerts;
    expect(a.overdue_reviews - before.overdue_reviews).toBe(1);
    expect(a.unassigned - before.unassigned).toBe(1);
    expect(a.ai_24h.failed - (before.ai_24h?.failed ?? 0)).toBe(3);
    expect(a.ai_rate_threshold).toBe(0.2);
    expect(typeof a.paid_not_queued).toBe("number");
  });
});

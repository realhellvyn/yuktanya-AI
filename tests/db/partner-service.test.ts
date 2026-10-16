import { afterAll, describe, expect, it } from "vitest";
import { createPgPartnerService } from "@/lib/partner/service";
import { createUser, getPool } from "./helpers";
import { makeKit, NOW } from "./phase3-helpers";

const pool = getPool();
afterAll(() => pool.end());
const kit = makeKit(pool);
const svc = createPgPartnerService(pool);

async function queued(firm: Awaited<ReturnType<typeof kit.firm>>) {
  await pool.query("update firms set is_default = false");
  await pool.query("update firms set is_default = true where id = $1", [firm.firmId]);
  const u = await createUser(pool);
  const b = await kit.buy(u, "STANDARD_REVIEW", (await kit.frozen(u)).versionId);
  return (await pool.query("select id from review_requests where order_id = $1", [b.order_id])).rows[0].id as string;
}

describe("team (koordinator)", () => {
  it("koordinator melihat reviewer firmanya: email, pekerjaan aktif, otorisasi; firma lain dan aktor lain tidak melihat apa pun", async () => {
    const f = await kit.firm();
    const active = await f.addReviewer();
    const expired = await f.addReviewer("2025-01-01", "2025-12-31");
    const req = await queued(f);
    await pool.query("select assign_review($1, $2, $3, $4)", [f.coordinator, req, active.reviewer, NOW]);
    const email = (await pool.query("select email from auth.users where id = $1", [active.reviewer])).rows[0].email;

    const rows = await svc.team(f.coordinator, NOW);
    expect(rows.map((r) => r.reviewerId).sort()).toEqual([active.reviewer, expired.reviewer].sort());
    const a = rows.find((r) => r.reviewerId === active.reviewer)!;
    expect(a).toMatchObject({ firmId: f.firmId, email, activeStandard: 1, activeDeep: 0, authorized: true });
    expect(a.authorization).toEqual({ validFrom: "2026-01-01", validTo: "2027-12-31", revoked: false });
    const e = rows.find((r) => r.reviewerId === expired.reviewer)!;
    expect(e.authorized).toBe(false);
    expect(e.authorization?.validTo).toBe("2025-12-31");

    const other = await kit.firm();
    await other.addReviewer();
    expect((await svc.team(other.coordinator, NOW)).map((r) => r.reviewerId)).not.toContain(active.reviewer);
    for (const actor of [active.reviewer, f.admin, await createUser(pool)]) expect(await svc.team(actor, NOW)).toEqual([]);
  });

  it("otorisasi dicabut ditampilkan sebagai dicabut dan tidak berwenang", async () => {
    const f = await kit.firm();
    const r = await f.addReviewer();
    await pool.query("select admin_revoke_authorization($1, $2, $3)", [f.admin, r.authId, NOW]);
    const row = (await svc.team(f.coordinator, NOW)).find((x) => x.reviewerId === r.reviewer)!;
    expect(row.authorized).toBe(false);
    expect(row.authorization?.revoked).toBe(true);
  });
});

describe("approvals (reviewer)", () => {
  it("hanya pekerjaan aktif milik reviewer; standar belum dibuka belum siap; standar lengkap siap; deep tanpa checklist belum siap", async () => {
    const f = await kit.firm();
    const r = await f.addReviewer();
    const other = await f.addReviewer();
    const fresh = await queued(f);
    await pool.query("select assign_review($1, $2, $3, $4)", [f.coordinator, fresh, r.reviewer, NOW]);
    const ready = await queued(f);
    await pool.query("select assign_review($1, $2, $3, $4)", [f.coordinator, ready, r.reviewer, NOW]);
    const s = (await pool.query("select * from start_review($1, $2, $3)", [r.reviewer, ready, NOW])).rows[0];
    await pool.query("select save_report_draft($1, $2, $3, 'Klausul kerahasiaan', '', '', $4)", [r.reviewer, ready, s.revision, NOW]);
    const foreign = await queued(f);
    await pool.query("select assign_review($1, $2, $3, $4)", [f.coordinator, foreign, other.reviewer, NOW]);

    const c = await kit.completedStandard();
    const b = await kit.buy(c.owner, "DEEP_REVIEW", c.req);
    const deep = (await pool.query("select id from deep_requests where order_id = $1", [b.order_id])).rows[0].id as string;
    await pool.query("select assign_deep($1, $2, $3, $4)", [c.f.coordinator, deep, c.r.reviewer, NOW]);

    const items = await svc.approvals(r.reviewer, NOW);
    expect(items.map((i) => i.id).sort()).toEqual([fresh, ready].sort());
    const fr = items.find((i) => i.id === fresh)!;
    expect(fr).toMatchObject({ kind: "STANDARD", href: `/partner/reviews/${fresh}`, ready: false, versionNo: 1 });
    expect(fr.reasons.join(" ")).toMatch(/Belum dibuka/);
    expect(items.find((i) => i.id === ready)).toMatchObject({ ready: true, reasons: [] });

    const d = await svc.approvals(c.r.reviewer, NOW);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ kind: "DEEP", id: deep, href: `/partner/deep/${deep}`, ready: false });
    expect(d[0].reasons.join(" ")).toMatch(/Belum dibuka/);
    expect(await svc.approvals(f.coordinator, NOW)).toEqual([]);
  });

  it("deep dengan checklist lengkap, pekerjaan tambahan, dan tindak lanjut → siap diputuskan", async () => {
    const c = await kit.completedStandard();
    const b = await kit.buy(c.owner, "DEEP_REVIEW", c.req);
    const deep = (await pool.query("select id from deep_requests where order_id = $1", [b.order_id])).rows[0].id as string;
    await pool.query("select assign_deep($1, $2, $3, $4)", [c.f.coordinator, deep, c.r.reviewer, NOW]);
    let rev = (await pool.query("select * from start_deep($1, $2, $3)", [c.r.reviewer, deep, NOW])).rows[0].revision as number;
    const half = await svc.approvals(c.r.reviewer, NOW);
    expect(half[0].reasons.join(" ")).toContain("Lengkapi checklist: M1, M2, M3, M4, M5, M6, M7");
    rev = (await pool.query("select save_deep_draft($1, $2, $3, 'Pekerjaan tambahan', '', $4) as r", [c.r.reviewer, deep, rev, NOW])).rows[0].r;
    rev = (await pool.query("select set_disposition($1, $2, $3, 1, 'RESOLVED', 'Bukti', $4) as r", [c.r.reviewer, deep, rev, NOW])).rows[0].r;
    for (const item of ["M1", "M2", "M3", "M4", "M5", "M6", "M7"]) {
      rev = (await pool.query("select set_checklist($1, $2, $3, $4, 'PASS', 'ok', 'bukti', $5) as r", [c.r.reviewer, deep, rev, item, NOW])).rows[0].r;
    }
    expect((await svc.approvals(c.r.reviewer, NOW))[0]).toMatchObject({ id: deep, ready: true, reasons: [] });
  });
});

describe("editor: data konfirmasi akhir (versi, hash, otorisasi, lingkup induk, rubrik)", () => {
  it("open() standar dan deep membawa versi dan hash yang dibayar", async () => {
    const { createPgReviewService } = await import("@/lib/reviews/service");
    const { createPgDeepService } = await import("@/lib/deep/service");
    const f = await kit.firm();
    const r = await f.addReviewer();
    const req = await queued(f);
    await pool.query("select assign_review($1, $2, $3, $4)", [f.coordinator, req, r.reviewer, NOW]);
    const o = await createPgReviewService(pool).open(r.reviewer, req, NOW);
    const hash = (await pool.query("select version_sha256 from review_requests where id = $1", [req])).rows[0].version_sha256;
    expect(o).toMatchObject({ versionNo: 1, sha256: hash, authorized: true });

    const c = await kit.completedStandard();
    const b = await kit.buy(c.owner, "DEEP_REVIEW", c.req);
    const deep = (await pool.query("select id, version_sha256 from deep_requests where order_id = $1", [b.order_id])).rows[0];
    await pool.query("select assign_deep($1, $2, $3, $4)", [c.f.coordinator, deep.id, c.r.reviewer, NOW]);
    const d = await createPgDeepService(pool).open(c.r.reviewer, deep.id, NOW);
    expect(d).toMatchObject({ versionNo: 1, sha256: deep.version_sha256, parentScope: "Klausul kerahasiaan", authorized: true });
    expect(typeof d.rubricApproved).toBe("boolean");
  });
});

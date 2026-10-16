import { afterAll, describe, expect, it } from "vitest";
import { createPgDeepService } from "@/lib/deep/service";
import { createPgReviewService } from "@/lib/reviews/service";
import { createUser, getPool } from "./helpers";
import { at, key, makeKit, NOW } from "./phase3-helpers";

// Migrasi 37 (Task 13): search_path fungsi analitik, kebuntuan settle_payment vs sapuan, dan konflik firma tidak menyangkutkan permintaan.
const pool = getPool();
afterAll(() => pool.end());
const kit = makeKit(pool);

describe("fungsi analitik memakai search_path tetap (audit C5a)", () => {
  it("analytics_event_names, analytics_safe_keys, analytics_safe_metadata", async () => {
    const { rows } = await pool.query("select proname, proconfig from pg_proc where pronamespace = 'public'::regnamespace and proname = any($1) order by proname",
      [["analytics_event_names", "analytics_safe_keys", "analytics_safe_metadata"]]);
    expect(rows.map((r) => [r.proname, r.proconfig])).toEqual([
      ["analytics_event_names", ["search_path=public"]], ["analytics_safe_keys", ["search_path=public"]], ["analytics_safe_metadata", ["search_path=public"]],
    ]);
    expect((await pool.query("select analytics_safe_metadata('{\"kind\":\"A\",\"nama\":\"Budi\"}'::jsonb) as m")).rows[0].m).toEqual({ kind: "A" });
    for (const role of ["anon", "authenticated"]) {
      expect((await pool.query("select has_function_privilege($1, 'public.analytics_safe_metadata(jsonb)', 'execute') as ok", [role])).rows[0].ok).toBe(false);
    }
  });
});

// Menunggu sampai backend `pid` terblokir menunggu kunci.
async function waitLocked(pid: number) {
  for (let i = 0; i < 200; i++) {
    const w = (await pool.query("select wait_event_type from pg_stat_activity where pid = $1", [pid])).rows[0];
    if (w?.wait_event_type === "Lock") return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`backend ${pid} tidak pernah menunggu kunci`);
}

describe("bawaan Task 12: settle_payment vs sapuan kedaluwarsa", () => {
  it("dua order lewat batas milik satu pengguna: pembayaran diselesaikan bersamaan dengan sapuan global tanpa deadlock", async () => {
    const u = await kit.member("2026-10-01", "2027-12-01"); // Member: dua dokumen baru dalam sehari
    const v1 = await kit.frozen(u);
    const v2 = await kit.frozen(u);
    const o1 = await kit.order(u, "STANDARD_REVIEW", v1.versionId);
    const o2 = await kit.order(u, "STANDARD_REVIEW", v2.versionId);
    const p1 = await kit.pay(u, o1.order_id);
    const p2 = await kit.pay(u, o2.order_id);
    // "hi" = pembayaran dengan id terbesar: sapuan mengunci id kecil lebih dulu, settlement versi lama mengunci "hi" lebih dulu.
    const hiId = (await pool.query("select id from payments where id = any($1) order by id desc limit 1", [[p1.paymentId, p2.paymentId]])).rows[0].id;
    const [hi, hiOrder, loOrder] = hiId === p1.paymentId ? [p1, o1, o2] : [p2, o2, o1];
    const late = at(25 * 60);
    const c0 = await pool.connect();
    const c1 = await pool.connect();
    const c2 = await pool.connect();
    try {
      const pid1 = (await c1.query("select pg_backend_pid() as pid")).rows[0].pid;
      const pid2 = (await c2.query("select pg_backend_pid() as pid")).rows[0].pid;
      await c0.query("begin");
      await c0.query("select 1 from orders where id = $1 for update", [hiOrder.order_id]);
      await c1.query("begin");
      const settle = c1.query("select settle_payment('mock', $1, $2, $3, 0, $4, $5) as r", [hi.ref, `ev-${key()}`, hiOrder.amount_idr, late, late])
        .then((r) => r.rows[0].r as string, (e: Error) => e);
      await waitLocked(pid1);
      const sweep = c2.query("select expire_orders($1) as n", [late]).then((r) => r.rows[0].n as number, (e: Error) => e);
      await waitLocked(pid2);
      await c0.query("commit");
      const settled = await settle;
      await c1.query(settled instanceof Error ? "rollback" : "commit");
      const swept = await sweep;
      expect(settled).toBe("RECONCILIATION_REQUIRED");
      expect(swept).not.toBeInstanceOf(Error);
    } finally {
      c0.release();
      c1.release();
      c2.release();
    }
    const st = async (id: string) => (await pool.query("select status from orders where id = $1", [id])).rows[0].status;
    expect(await st(hiOrder.order_id)).toBe("RECONCILIATION_REQUIRED");
    expect(await st(loOrder.order_id)).toBe("EXPIRED");
    expect((await pool.query("select status from payments where id = $1", [hi.paymentId])).rows[0].status).toBe("DISPUTED");
  });

  it("pembayaran tepat waktu yang diproses terlambat tetap lunas (perilaku lama dipertahankan)", async () => {
    const u = await createUser(pool);
    const o = await kit.order(u, "MEMBERSHIP_MONTHLY", null);
    const p = await kit.pay(u, o.order_id);
    const r = (await pool.query("select settle_payment('mock', $1, $2, $3, 0, $4, $5) as r", [p.ref, `ev-${key()}`, o.amount_idr, at(25 * 60), at(60)])).rows[0].r;
    expect(r).toBe("SETTLED");
  });
});

async function assignedStandard() {
  await pool.query("update firms set is_default = false");
  const f = await kit.firm({ isDefault: true });
  const A = await f.addReviewer();
  const owner = await createUser(pool);
  const v = await kit.frozen(owner);
  const o = await kit.buy(owner, "STANDARD_REVIEW", v.versionId);
  const req = (await pool.query("select id from review_requests where order_id = $1", [o.order_id])).rows[0].id as string;
  await pool.query("select assign_review($1, $2, $3, $4)", [f.coordinator, req, A.reviewer, NOW]);
  await pool.query("select * from start_review($1, $2, $3)", [A.reviewer, req, NOW]);
  return { f, A, owner, req };
}

describe("bawaan Task 12: konflik firma tidak menyangkutkan permintaan", () => {
  it("standar IN_REVIEW: penugasan aktif berakhir, permintaan kembali ke perutean admin dengan tanda konflik, lalu dapat ditugaskan ke firma lain", async () => {
    const x = await assignedStandard();
    await pool.query("select declare_firm_conflict($1, 'STANDARD', $2, $3)", [x.f.coordinator, x.req, at(5)]);
    const r = (await pool.query("select status, firm_id from review_requests where id = $1", [x.req])).rows[0];
    expect(r).toEqual({ status: "QUEUED", firm_id: null });
    const asg = (await pool.query("select status, ended_at from review_assignments where request_id = $1", [x.req])).rows;
    expect(asg).toEqual([{ status: "ENDED", ended_at: at(5) }]);
    expect((await pool.query("select * from reviewer_queue($1)", [x.A.reviewer])).rows).toEqual([]);
    const audit = (await pool.query("select metadata_safe from audit_events where event_type = 'firm_conflict_declared' and entity_id = $1", [x.req])).rows;
    expect(audit[0].metadata_safe).toMatchObject({ firm_id: x.f.firmId, assignment_ended: true });

    const svc = createPgReviewService(pool);
    const admin = await kit.admin();
    expect((await svc.unassigned(admin)).find((u) => u.requestId === x.req)).toMatchObject({ conflict: true });
    // Firma yang berkonflik tidak lagi memegang permintaan ini; reviewernya tetap ditolak walau dirutekan admin.
    expect((await svc.unassigned(x.f.coordinator)).map((u) => u.requestId)).not.toContain(x.req);
    await expect(pool.query("select assign_review($1, $2, $3, $4)", [x.f.coordinator, x.req, x.A.reviewer, NOW])).rejects.toThrow(/FORBIDDEN/);
    await expect(pool.query("select assign_review($1, $2, $3, $4)", [admin, x.req, x.A.reviewer, NOW])).rejects.toThrow(/CONFLICT_OF_INTEREST/);
    const g = await kit.firm();
    const B = await g.addReviewer();
    await pool.query("select assign_review($1, $2, $3, $4)", [admin, x.req, B.reviewer, at(10)]);
    expect((await pool.query("select status, firm_id from review_requests where id = $1", [x.req])).rows[0]).toEqual({ status: "ASSIGNED", firm_id: g.firmId });
  });

  it("konflik berlaku untuk pasangan firma-pemilik: permintaan lain pemilik itu di firma yang sama ikut dilepas", async () => {
    await pool.query("update firms set is_default = false");
    const f = await kit.firm({ isDefault: true });
    const A = await f.addReviewer();
    const owner = await kit.member("2026-10-01", "2027-12-01");
    const reqs: string[] = [];
    for (let i = 0; i < 2; i++) {
      const v = await kit.frozen(owner);
      const o = await kit.buy(owner, "STANDARD_REVIEW", v.versionId);
      reqs.push((await pool.query("select id from review_requests where order_id = $1", [o.order_id])).rows[0].id);
    }
    await pool.query("select assign_review($1, $2, $3, $4)", [f.coordinator, reqs[1], A.reviewer, NOW]);
    await pool.query("select * from start_review($1, $2, $3)", [A.reviewer, reqs[1], NOW]);
    await pool.query("select declare_firm_conflict($1, 'STANDARD', $2, $3)", [f.coordinator, reqs[0], NOW]);
    const rows = (await pool.query("select id, status, firm_id from review_requests where id = any($1) order by id", [reqs])).rows;
    expect(rows.map((r) => [r.status, r.firm_id])).toEqual([["QUEUED", null], ["QUEUED", null]]);
    expect((await pool.query("select count(*)::int as n from review_assignments where request_id = any($1) and status = 'ACTIVE'", [reqs])).rows[0].n).toBe(0);
    const audit = (await pool.query("select metadata_safe from audit_events where event_type = 'firm_conflict_declared' and entity_id = $1", [reqs[0]])).rows[0];
    expect(audit.metadata_safe).toMatchObject({ assignment_ended: true, released: 2 });
    const flags = (await createPgReviewService(pool).unassigned(f.admin)).filter((u) => reqs.includes(u.requestId)).map((u) => u.conflict);
    expect(flags).toEqual([true, true]);
  });

  it("penjaga terbit tetap menolak bila konflik firma ada saat penugasan masih aktif (pertahanan berlapis)", async () => {
    const x = await assignedStandard();
    let rev = (await pool.query("select revision from review_reports where request_id = $1", [x.req])).rows[0].revision as number;
    rev = (await pool.query("select save_report_draft($1, $2, $3, 'Lingkup', '', '', $4) as r", [x.A.reviewer, x.req, rev, NOW])).rows[0].r;
    // Baris konflik yang ditulis langsung (mis. data lama dari migrasi 36), tanpa pelepasan penugasan.
    await pool.query("insert into firm_conflicts (firm_id, owner_id, declared_by, declared_at, source_kind, source_id) values ($1, $2, $3, $4, 'STANDARD', $5)",
      [x.f.firmId, x.owner, x.f.coordinator, NOW, x.req]);
    await expect(pool.query("select * from publish_standard($1, $2, $3, 'WITHIN_SCOPE', true, true, true, $4)", [x.A.reviewer, x.req, rev, NOW]))
      .rejects.toThrow(/CONFLICT_OF_INTEREST/);
  });

  it("deep IN_REVIEW: penugasan berakhir dan permintaan kembali ke antrean admin dengan tanda konflik", async () => {
    const c = await kit.completedStandard();
    const b = await kit.buy(c.owner, "DEEP_REVIEW", c.req);
    const deep = (await pool.query("select id from deep_requests where order_id = $1", [b.order_id])).rows[0].id as string;
    await pool.query("select assign_deep($1, $2, $3, $4)", [c.f.coordinator, deep, c.r.reviewer, NOW]);
    await pool.query("select * from start_deep($1, $2, $3)", [c.r.reviewer, deep, NOW]);
    await pool.query("select declare_firm_conflict($1, 'DEEP', $2, $3)", [c.f.coordinator, deep, at(5)]);
    expect((await pool.query("select status, firm_id from deep_requests where id = $1", [deep])).rows[0]).toEqual({ status: "QUEUED", firm_id: null });
    expect((await pool.query("select count(*)::int as n from deep_assignments where deep_id = $1 and status = 'ACTIVE'", [deep])).rows[0].n).toBe(0);
    const admin = await kit.admin();
    expect((await createPgDeepService(pool).unassigned(admin)).find((d) => d.deepId === deep)).toMatchObject({ conflict: true });
    await expect(pool.query("select assign_deep($1, $2, $3, $4)", [admin, deep, c.r.reviewer, NOW])).rejects.toThrow(/CONFLICT_OF_INTEREST/);
  });
});

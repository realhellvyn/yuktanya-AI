import { afterAll, describe, expect, it } from "vitest";
import { createUser, getPool } from "./helpers";
import { makeKit, NOW } from "./phase3-helpers";

// Regresi audit B (B-01): pekerjaan reviewer sebelumnya tidak dihitung untuk penanda tangan baru.
const pool = getPool();
afterAll(() => pool.end());
const kit = makeKit(pool);
const ITEMS = ["M1", "M2", "M3", "M4", "M5", "M6", "M7"];

describe("B-01: pekerjaan reviewer sebelumnya tidak terbawa", () => {
  it("deep: B tidak dapat menyetujui Enhanced dari checklist dan disposisi milik A yang otorisasinya dicabut", async () => {
    const admin = await kit.admin();
    await pool.query("select admin_approve_rubric($1, 'v8-proposed', 'Persetujuan mitra #1', $2)", [admin, NOW]);
    const c = await kit.completedStandard({ severity: "MATERIAL" });
    const b = await kit.buy(c.owner, "DEEP_REVIEW", c.req);
    const deep = (await pool.query("select * from deep_requests where order_id = $1", [b.order_id])).rows[0];
    const A = await c.f.addReviewer();
    const B = await c.f.addReviewer();
    await pool.query("select assign_deep($1, $2, $3, $4)", [c.f.coordinator, deep.id, A.reviewer, NOW]);
    let rev = (await pool.query("select * from start_deep($1, $2, $3)", [A.reviewer, deep.id, NOW])).rows[0].revision;
    const bump = async (sql: string, args: unknown[]) => { rev = (await pool.query(sql, [A.reviewer, deep.id, rev, ...args, NOW])).rows[0].r; };
    await bump("select save_deep_draft($1, $2, $3, $4, $5, $6) as r", ["Kerja tambahan oleh A", "Ringkasan A"]);
    await bump("select set_disposition($1, $2, $3, 1, $4, $5, $6) as r", ["RESOLVED", "Bukti A"]);
    for (const i of ITEMS) await bump("select set_checklist($1, $2, $3, $4, $5, $6, $7, $8) as r", [i, "PASS", "Penalaran A", "Bukti A"]);
    await pool.query("select admin_revoke_authorization($1, $2, $3)", [c.f.admin, A.authId, NOW]);
    await pool.query("select reassign_deep($1, $2, $3, $4)", [c.f.coordinator, deep.id, B.reviewer, NOW]);
    const s = (await pool.query("select * from start_deep($1, $2, $3)", [B.reviewer, deep.id, NOW])).rows[0];
    let revB = s.revision as number;
    const decideB = () => pool.query("select * from decide_deep($1, $2, $3, 'APPROVE', null, true, true, true, $4)", [B.reviewer, deep.id, revB, NOW]);
    await expect(decideB()).rejects.toThrow(/REPORT_NOT_CONFIRMED/);
    const bumpB = async (sql: string, args: unknown[]) => { revB = (await pool.query(sql, [B.reviewer, deep.id, revB, ...args, NOW])).rows[0].r; };
    // B menyimpan ulang pekerjaan tambahan; disposisi dan checklist A tetap tidak dihitung.
    await bumpB("select save_deep_draft($1, $2, $3, $4, $5, $6) as r", ["Kerja tambahan diperiksa ulang oleh B", "Ringkasan B"]);
    await expect(decideB()).rejects.toThrow(/DISPOSITION_NOT_CONFIRMED/);
    await bumpB("select set_disposition($1, $2, $3, 1, $4, $5, $6) as r", ["RESOLVED", "Bukti B"]);
    await expect(decideB()).rejects.toThrow(/CHECKLIST_NOT_CONFIRMED/);
    for (const i of ITEMS.slice(0, 6)) await bumpB("select set_checklist($1, $2, $3, $4, $5, $6, $7, $8) as r", [i, "PASS", "Penalaran B", "Bukti B"]);
    await expect(decideB()).rejects.toThrow(/CHECKLIST_NOT_CONFIRMED/);
    await bumpB("select set_checklist($1, $2, $3, $4, $5, $6, $7, $8) as r", ["M7", "PASS", "Penalaran B", "Bukti B"]);
    expect((await decideB()).rows[0].outcome).toBe("ENHANCED_APPROVED");
    const rep = (await pool.query("select id, drafted_by from deep_reports where deep_id = $1", [deep.id])).rows[0];
    expect(rep.drafted_by).toBe(B.reviewer);
    const authors = (await pool.query("select distinct assessed_by from deep_checklist where report_id = $1 union select distinct assessed_by from deep_dispositions where report_id = $1", [rep.id])).rows;
    expect(authors).toEqual([{ assessed_by: B.reviewer }]);
  });

  it("deep: reviewer yang sama setelah penugasan ulang kepadanya kembali juga harus mengonfirmasi ulang (terikat penugasan, bukan orang)", async () => {
    const admin = await kit.admin();
    await pool.query("select admin_approve_rubric($1, 'v8-proposed', 'Persetujuan mitra #1', $2)", [admin, NOW]);
    const c = await kit.completedStandard({ severity: "MATERIAL" });
    const b = await kit.buy(c.owner, "DEEP_REVIEW", c.req);
    const deep = (await pool.query("select * from deep_requests where order_id = $1", [b.order_id])).rows[0];
    const A = await c.f.addReviewer();
    const B = await c.f.addReviewer();
    await pool.query("select assign_deep($1, $2, $3, $4)", [c.f.coordinator, deep.id, A.reviewer, NOW]);
    let rev = (await pool.query("select * from start_deep($1, $2, $3)", [A.reviewer, deep.id, NOW])).rows[0].revision;
    const bump = async (sql: string, args: unknown[]) => { rev = (await pool.query(sql, [A.reviewer, deep.id, rev, ...args, NOW])).rows[0].r; };
    await bump("select set_disposition($1, $2, $3, 1, $4, $5, $6) as r", ["RESOLVED", "Bukti A"]);
    await pool.query("select reassign_deep($1, $2, $3, $4)", [c.f.coordinator, deep.id, B.reviewer, NOW]);
    await pool.query("select reassign_deep($1, $2, $3, $4)", [c.f.coordinator, deep.id, A.reviewer, NOW]);
    rev = (await pool.query("select * from start_deep($1, $2, $3)", [A.reviewer, deep.id, NOW])).rows[0].revision;
    await expect(pool.query("select * from decide_deep($1, $2, $3, 'DENY', 'Belum terpenuhi', true, true, true, $4)", [A.reviewer, deep.id, rev, NOW]))
      .rejects.toThrow(/DISPOSITION_NOT_CONFIRMED/);
  });

  it("standar: B tidak dapat menerbitkan Legal Note dan lingkup yang ditulis A", async () => {
    await pool.query("update firms set is_default = false");
    const f = await kit.firm({ isDefault: true });
    const A = await f.addReviewer();
    const B = await f.addReviewer();
    const owner = await createUser(pool);
    const v = await kit.frozen(owner);
    const o = await kit.buy(owner, "STANDARD_REVIEW", v.versionId);
    const req = (await pool.query("select id from review_requests where order_id = $1", [o.order_id])).rows[0].id as string;
    await pool.query("select assign_review($1, $2, $3, $4)", [f.coordinator, req, A.reviewer, NOW]);
    let rev = (await pool.query("select * from start_review($1, $2, $3)", [A.reviewer, req, NOW])).rows[0].revision as number;
    rev = (await pool.query("select save_report_draft($1, $2, $3, 'Lingkup A', '', '', $4) as r", [A.reviewer, req, rev, NOW])).rows[0].r;
    const note = { title: "Catatan A", finding: "Temuan A", severity: "MINOR", actionable: true, recommended_action: "Perjelas" };
    await pool.query("select * from upsert_note($1, $2, $3, $4, $5)", [A.reviewer, req, rev, JSON.stringify(note), NOW]);
    await pool.query("select admin_revoke_authorization($1, $2, $3)", [f.admin, A.authId, NOW]);
    await pool.query("select reassign_review($1, $2, $3, $4)", [f.coordinator, req, B.reviewer, NOW]);
    const s = (await pool.query("select * from start_review($1, $2, $3)", [B.reviewer, req, NOW])).rows[0];
    let revB = s.revision as number;
    const publishB = () => pool.query("select * from publish_standard($1, $2, $3, 'WITH_NOTES', false, true, true, $4)", [B.reviewer, req, revB, NOW]);
    await expect(publishB()).rejects.toThrow(/REPORT_NOT_CONFIRMED/);
    revB = (await pool.query("select save_report_draft($1, $2, $3, 'Lingkup diperiksa ulang B', '', '', $4) as r", [B.reviewer, req, revB, NOW])).rows[0].r;
    await expect(publishB()).rejects.toThrow(/NOTE_NOT_CONFIRMED/);
    // B mengonfirmasi catatan 1 dengan menyimpannya ulang atas namanya.
    revB = (await pool.query("select * from upsert_note($1, $2, $3, $4, $5)", [B.reviewer, req, revB, JSON.stringify({ ...note, note_no: 1 }), NOW])).rows[0].revision;
    expect((await publishB()).rows[0].status).toBe("WITH_NOTES");
    const n = (await pool.query("select n.author_id, n.status from legal_notes n join review_reports rp on rp.id = n.report_id where rp.request_id = $1", [req])).rows;
    expect(n).toEqual([{ author_id: B.reviewer, status: "PUBLISHED" }]);
    expect((await pool.query("select drafted_by from review_reports where request_id = $1", [req])).rows[0].drafted_by).toBe(B.reviewer);
  });
});

// ---------- B-02, Minor B, dan bawaan Task 11 (ditulis terhadap API baru) ----------
const SUMMARY = "Sengketa wanprestasi dengan banyak pihak dan nilai besar, perlu penilaian khusus.";
const keyOf = () => `k-${Math.random().toString(36).slice(2)}-abcdef`;
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

async function standardAssigned() {
  await pool.query("update firms set is_default = false");
  const f = await kit.firm({ isDefault: true });
  const A = await f.addReviewer();
  const owner = await createUser(pool);
  const v = await kit.frozen(owner);
  const o = await kit.buy(owner, "STANDARD_REVIEW", v.versionId);
  const req = (await pool.query("select id from review_requests where order_id = $1", [o.order_id])).rows[0].id as string;
  return { f, A, owner, v, req };
}
async function readyToPublish(x: Awaited<ReturnType<typeof standardAssigned>>) {
  await pool.query("select assign_review($1, $2, $3, $4)", [x.f.coordinator, x.req, x.A.reviewer, NOW]);
  let rev = (await pool.query("select * from start_review($1, $2, $3)", [x.A.reviewer, x.req, NOW])).rows[0].revision as number;
  rev = (await pool.query("select save_report_draft($1, $2, $3, 'Lingkup', '', '', $4) as r", [x.A.reviewer, x.req, rev, NOW])).rows[0].r;
  return rev;
}
const publish8 = (who: string, req: string, rev: number, noConflict: boolean | null) =>
  pool.query("select * from publish_standard($1, $2, $3, 'WITHIN_SCOPE', true, true, $4, $5)", [who, req, rev, noConflict, NOW]);

describe("B-02: konflik kepentingan", () => {
  it("terbit standar wajib pernyataan tanpa konflik yang tersimpan; tanda tangan lama ditolak", async () => {
    const x = await standardAssigned();
    const rev = await readyToPublish(x);
    await expect(pool.query("select * from publish_standard($1, $2, $3, 'WITHIN_SCOPE', true, true, $4)", [x.A.reviewer, x.req, rev, NOW]))
      .rejects.toThrow(/CONFLICT_ATTESTATION_REQUIRED/);
    await expect(publish8(x.A.reviewer, x.req, rev, false)).rejects.toThrow(/CONFLICT_ATTESTATION_REQUIRED/);
    const r = (await publish8(x.A.reviewer, x.req, rev, true)).rows[0];
    expect(r.status).toBe("WITHIN_SCOPE");
    const rep = (await pool.query("select no_conflict_attested_at from review_reports where request_id = $1", [x.req])).rows[0];
    expect(rep.no_conflict_attested_at).toEqual(NOW);
    const dv = (await pool.query("select issuer from document_verifications where id = $1", [r.verification_id])).rows[0];
    expect(dv.issuer).toMatchObject({ no_conflict_attested: true });
  });

  it("konflik tingkat firma: koordinator mencatat; penugasan dan penerbitan ditolak; koordinator firma lain dan pengguna biasa ditolak", async () => {
    const x = await standardAssigned();
    const other = await kit.firm();
    await expect(pool.query("select declare_firm_conflict($1, 'STANDARD', $2, $3)", [other.coordinator, x.req, NOW])).rejects.toThrow(/FORBIDDEN/);
    await expect(pool.query("select declare_firm_conflict($1, 'STANDARD', $2, $3)", [x.owner, x.req, NOW])).rejects.toThrow(/FORBIDDEN/);
    await pool.query("select declare_firm_conflict($1, 'STANDARD', $2, $3)", [x.f.coordinator, x.req, NOW]);
    // Task 13: permintaan dilepas dari firma yang berkonflik (kembali ke perutean admin); reviewer firma itu tetap ditolak.
    await expect(pool.query("select assign_review($1, $2, $3, $4)", [x.f.coordinator, x.req, x.A.reviewer, NOW])).rejects.toThrow(/FORBIDDEN/);
    await expect(pool.query("select assign_review($1, $2, $3, $4)", [x.f.admin, x.req, x.A.reviewer, NOW])).rejects.toThrow(/CONFLICT_OF_INTEREST/);
    const audit = (await pool.query("select metadata_safe from audit_events where event_type = 'firm_conflict_declared' and entity_id = $1", [x.req])).rows;
    expect(audit).toHaveLength(1);
    // Konflik yang dicatat saat pekerjaan berjalan menahan penerbitan (Task 13: penugasan reviewer itu juga diakhiri).
    const y = await standardAssigned();
    const rev = await readyToPublish(y);
    await pool.query("select declare_firm_conflict($1, 'STANDARD', $2, $3)", [y.f.coordinator, y.req, NOW]);
    await expect(publish8(y.A.reviewer, y.req, rev, true)).rejects.toThrow(/FORBIDDEN/);
  });

  it("reviewer yang juga pemilik dokumen tidak dapat ditugaskan", async () => {
    const x = await standardAssigned();
    await pool.query("select admin_add_member($1, $2, $3, 'reviewer')", [x.f.admin, x.f.firmId, x.owner]);
    await pool.query("select admin_authorize($1, $2, $3, 'Kontrak', '2026-01-01', '2027-12-31')", [x.f.admin, x.owner, x.f.firmId]);
    await expect(pool.query("select assign_review($1, $2, $3, $4)", [x.f.coordinator, x.req, x.owner, NOW])).rejects.toThrow(/REVIEWER_NOT_AUTHORIZED|CONFLICT_OF_INTEREST/);
  });

  it("kelayakan Deep menolak bila dokumen induk punya kasus khusus terbuka; penolakan di order tercatat di audit", async () => {
    const c = await kit.completedStandard({ severity: "MATERIAL" });
    expect((await pool.query("select * from deep_eligibility($1, $2, $3)", [c.owner, c.req, NOW])).rows[0].reason).toBe("OK");
    await pool.query("select submit_special_case($1, $2, $3, true, $4, $5)", [c.owner, c.v.documentId, SUMMARY, keyOf(), NOW]);
    expect((await pool.query("select * from deep_eligibility($1, $2, $3)", [c.owner, c.req, NOW])).rows[0]).toMatchObject({ eligible: false, reason: "SPECIAL_CASE_OPEN" });
    const { createPgBillingService } = await import("@/lib/billing/service");
    const svc = createPgBillingService(pool, []);
    await expect(svc.createOrder(c.owner, "DEEP_REVIEW", c.req, keyOf(), NOW)).rejects.toMatchObject({ code: "NOT_ELIGIBLE", reason: "SPECIAL_CASE_OPEN" });
    const ev = (await pool.query("select actor_id, metadata_safe from audit_events where event_type = 'deep_eligibility_rejected' and entity_id = $1", [c.req])).rows;
    expect(ev).toEqual([{ actor_id: c.owner, metadata_safe: { reason: "SPECIAL_CASE_OPEN", stage: "ORDER" } }]);
  });
});

describe("Minor B", () => {
  it("decide_deep menegakkan flag ENHANCED_ISSUANCE dari server; keputusan lain tetap boleh", async () => {
    const admin = await kit.admin();
    await pool.query("select admin_approve_rubric($1, 'v8-proposed', 'Persetujuan mitra #1', $2)", [admin, NOW]);
    const c = await kit.completedStandard({ severity: "MATERIAL" });
    const b = await kit.buy(c.owner, "DEEP_REVIEW", c.req);
    const deep = (await pool.query("select * from deep_requests where order_id = $1", [b.order_id])).rows[0];
    await pool.query("select assign_deep($1, $2, $3, $4)", [c.f.coordinator, deep.id, c.r.reviewer, NOW]);
    let rev = (await pool.query("select * from start_deep($1, $2, $3)", [c.r.reviewer, deep.id, NOW])).rows[0].revision;
    const bump = async (sql: string, args: unknown[]) => { rev = (await pool.query(sql, [c.r.reviewer, deep.id, rev, ...args, NOW])).rows[0].r; };
    await bump("select save_deep_draft($1, $2, $3, $4, $5, $6) as r", ["Kerja tambahan", "Ringkasan"]);
    await bump("select set_disposition($1, $2, $3, 1, $4, $5, $6) as r", ["RESOLVED", "Bukti"]);
    for (const i of ITEMS) await bump("select set_checklist($1, $2, $3, $4, $5, $6, $7, $8) as r", [i, "PASS", "Penalaran rahasia", "Bukti rahasia"]);
    const decide = (decision: string, enhanced: boolean, reason: string | null = null) =>
      pool.query("select * from decide_deep($1, $2, $3, $4, $5, true, true, $6, $7)", [c.r.reviewer, deep.id, rev, decision, reason, enhanced, NOW]);
    await expect(decide("APPROVE", false)).rejects.toThrow(/ENHANCED_DISABLED/);
    await expect(pool.query("select * from decide_deep($1, $2, $3, 'APPROVE', null, true, $4)", [c.r.reviewer, deep.id, rev, NOW])).rejects.toThrow(/CONFLICT_ATTESTATION_REQUIRED/);
    // Audit setiap pengisian checklist/disposisi tanpa isi penalaran/bukti.
    const ev = (await pool.query("select event_type, metadata_safe from audit_events where entity_id = $1 and event_type in ('deep_checklist_set', 'deep_disposition_set')", [deep.id])).rows;
    expect(ev.filter((e) => e.event_type === "deep_checklist_set")).toHaveLength(7);
    expect(ev.filter((e) => e.event_type === "deep_disposition_set")).toHaveLength(1);
    expect(JSON.stringify(ev)).not.toMatch(/rahasia|Bukti/);
    const r = (await decide("DENY", false, "Kriteria belum terpenuhi")).rows[0];
    expect(r.outcome).toBe("COMPLETED_WITH_NOTES");
    expect((await pool.query("select no_conflict_attested_at from deep_reports where deep_id = $1", [deep.id])).rows[0].no_conflict_attested_at).toEqual(NOW);
  });

  it("verifikasi yang dicabut tidak dapat diaktifkan kembali lewat UPDATE langsung", async () => {
    const c = await kit.completedStandard({ severity: "MATERIAL" });
    await pool.query("select revoke_verification($1, $2, 'ERROR', 'uji', $3)", [c.f.admin, c.verificationId, NOW]);
    await expect(pool.query("update document_verifications set status = 'ACTIVE' where id = $1", [c.verificationId])).rejects.toThrow(/revoked/i);
    await expect(pool.query("update document_verifications set status = 'SUSPENDED' where id = $1", [c.verificationId])).rejects.toThrow(/revoked/i);
  });

  it("audit Legal Note tanpa isi temuan", async () => {
    const x = await standardAssigned();
    const rev = await readyToPublish(x);
    const note = { title: "Judul rahasia", finding: "Temuan rahasia", severity: "MINOR", actionable: true, recommended_action: "Tindakan rahasia" };
    await pool.query("select * from upsert_note($1, $2, $3, $4, $5)", [x.A.reviewer, x.req, rev, JSON.stringify(note), NOW]);
    const ev = (await pool.query("select metadata_safe from audit_events where entity_id = $1 and event_type = 'legal_note_saved'", [x.req])).rows;
    expect(ev).toHaveLength(1);
    expect(JSON.stringify(ev)).not.toMatch(/rahasia/);
  });

  it("penolakan kelayakan Deep saat settlement tercatat di audit", async () => {
    const c = await kit.completedStandard({ severity: "MATERIAL" });
    const o = await kit.order(c.owner, "DEEP_REVIEW", c.req);
    const p = await kit.pay(c.owner, o.order_id);
    await pool.query("select revoke_verification($1, $2, 'ERROR', 'uji', $3)", [c.f.admin, c.verificationId, NOW]);
    expect(await kit.settle("mock", p.ref, o.amount_idr)).toBe("RECONCILIATION_REQUIRED");
    const ev = (await pool.query("select metadata_safe from audit_events where event_type = 'deep_eligibility_rejected' and entity_id = $1", [c.req])).rows;
    expect(ev).toHaveLength(1);
    expect(ev[0].metadata_safe).toMatchObject({ reason: "PARENT_NOT_ACTIVE", stage: "SETTLEMENT" });
  });

  it("penolakan kelayakan Deep saat rekonsiliasi admin tercatat dengan aktor admin, bukan pemilik (Task 14)", async () => {
    const c = await kit.completedStandard({ severity: "MATERIAL" });
    const o = await kit.order(c.owner, "DEEP_REVIEW", c.req);
    const p = await kit.pay(c.owner, o.order_id);
    await pool.query("select revoke_verification($1, $2, 'ERROR', 'uji', $3)", [c.f.admin, c.verificationId, NOW]);
    expect(await kit.settle("mock", p.ref, o.amount_idr)).toBe("RECONCILIATION_REQUIRED");
    const { createPgBillingService } = await import("@/lib/billing/service");
    const svc = createPgBillingService(pool, []);
    await expect(svc.resolveReconciliation(c.f.admin, o.order_id, "ACTIVATE", "Coba aktifkan", NOW)).rejects.toMatchObject({ code: "NOT_ELIGIBLE" });
    const ev = (await pool.query("select actor_id, metadata_safe from audit_events where event_type = 'deep_eligibility_rejected' and entity_id = $1 and metadata_safe ->> 'stage' = 'RECONCILIATION'", [c.req])).rows;
    expect(ev).toEqual([{ actor_id: c.f.admin, metadata_safe: { reason: "PARENT_NOT_ACTIVE", stage: "RECONCILIATION" } }]);
  });
});

describe("bawaan Task 11 (penagihan)", () => {
  it("(a) sapuan kedaluwarsa mengunci pembayaran dulu: settlement serentak tidak deadlock dan tetap lunas", async () => {
    const u = await createUser(pool);
    const o = await kit.order(u, "MEMBERSHIP_MONTHLY", null);
    const p = await kit.pay(u, o.order_id);
    const c1 = await pool.connect();
    const c2 = await pool.connect();
    try {
      const pid2 = (await c2.query("select pg_backend_pid() as pid")).rows[0].pid;
      await c1.query("begin");
      await c1.query("select 1 from payments where id = $1 for update", [p.paymentId]);
      const sweep = c2.query("select expire_orders_scoped($1, $2) as n", [u, at(25 * 60)]).then((r) => r.rows[0].n, (e: Error) => e);
      for (let i = 0; i < 100; i++) {
        const w = (await pool.query("select wait_event_type from pg_stat_activity where pid = $1", [pid2])).rows[0];
        if (w?.wait_event_type === "Lock") break;
        await new Promise((r) => setTimeout(r, 20));
      }
      const settled = await c1.query("select settle_payment('mock', $1, $2, $3, 0, $4, $5) as r", [p.ref, `ev-${keyOf()}`, o.amount_idr, at(25 * 60), at(60)])
        .then((r) => r.rows[0].r, (e: Error) => e);
      await c1.query(settled instanceof Error ? "rollback" : "commit");
      const swept = await sweep;
      expect(settled).toBe("SETTLED");
      expect(swept).not.toBeInstanceOf(Error);
    } finally {
      c1.release();
      c2.release();
    }
    expect((await pool.query("select status from orders where id = $1", [o.order_id])).rows[0].status).toBe("PAID");
  });

  it("(b) pembayaran DISPUTED pada order yang sudah dibatalkan tampil di daftar admin dan dapat dicatat pengembaliannya", async () => {
    const { createPgBillingService } = await import("@/lib/billing/service");
    const { createMockAdapter, createManualAdapter } = await import("@/lib/billing/adapters");
    const svc = createPgBillingService(pool, [createMockAdapter(), createManualAdapter("uji")]);
    const admin = await kit.admin();
    const u = await createUser(pool);
    const o = await kit.order(u, "MEMBERSHIP_MONTHLY", null);
    const p1 = await kit.pay(u, o.order_id, "mock");
    const p2 = await kit.pay(u, o.order_id, "manual");
    expect(await kit.settle("mock", p1.ref, o.amount_idr, at(26 * 60))).toBe("RECONCILIATION_REQUIRED");
    expect(await kit.settle("manual", p2.ref, o.amount_idr, at(27 * 60))).toBe("RECONCILIATION_REQUIRED");
    await pool.query("select admin_resolve_reconciliation($1, $2, 'REFUND_RECORDED', 'dana dikembalikan', $3)", [admin, o.order_id, at(28 * 60)]);
    expect((await pool.query("select status from orders where id = $1", [o.order_id])).rows[0].status).toBe("CANCELLED");
    const left = (await pool.query("select id from payments where order_id = $1 and status = 'DISPUTED'", [o.order_id])).rows;
    expect(left).toHaveLength(1);
    const item = (await svc.reconciliation()).find((r) => r.paymentId === left[0].id);
    expect(item).toMatchObject({ orderId: o.order_id, status: "CANCELLED", extraPayment: true });
    expect((await pool.query("select admin_resolve_reconciliation($1, $2, 'REFUND_RECORDED', 'dana kedua dikembalikan', $3) as r", [admin, o.order_id, at(29 * 60)])).rows[0].r).toBe("REFUND_RECORDED");
    expect((await pool.query("select status from payments where id = $1", [left[0].id])).rows[0].status).toBe("REFUNDED");
    await expect(pool.query("select admin_resolve_reconciliation($1, $2, 'ACTIVATE', 'aktifkan saja', $3)", [admin, o.order_id, at(30 * 60)])).rejects.toThrow(/NOT_RECONCILIATION/);
  });

  it("(c) ACTIVATE menyapu order kedaluwarsa lebih dulu: entitlement order lain yang lewat batas tidak menghasilkan DISCOUNT_TAKEN palsu", async () => {
    await pool.query("update firms set is_default = false");
    const admin = await kit.admin();
    const u = await kit.member("2026-10-01", "2026-11-01");
    const a = await kit.order(u, "STANDARD_REVIEW", (await kit.frozen(u)).versionId);
    expect(a.amount_idr).toBe(30000);
    const pa = await kit.pay(u, a.order_id);
    const b = await kit.order(u, "STANDARD_REVIEW", (await kit.frozen(u)).versionId, at(25 * 60));
    expect(b.amount_idr).toBe(30000);
    await kit.pay(u, b.order_id, "mock", at(25 * 60));
    expect(await kit.settle("mock", pa.ref, 30000, at(26 * 60))).toBe("RECONCILIATION_REQUIRED");
    // Order b lewat batas (25 jam + 24 jam) tetapi belum disapu.
    const r = await pool.query("select admin_resolve_reconciliation($1, $2, 'ACTIVATE', 'dana diterima terlambat', $3) as r", [admin, a.order_id, at(50 * 60)]);
    expect(r.rows[0].r).toBe("ACTIVATED");
    expect((await pool.query("select status from orders where id = $1", [b.order_id])).rows[0].status).toBe("EXPIRED");
  });
});

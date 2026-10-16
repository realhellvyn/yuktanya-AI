import { afterAll, describe, expect, it } from "vitest";
import { createUser, getPool } from "./helpers";
import { makeKit, NOW, at } from "./phase3-helpers";

const pool = getPool();
afterAll(() => pool.end());
const kit = makeKit(pool);

type Ctx = Awaited<ReturnType<typeof setup>>;
async function setup() {
  await pool.query("update firms set is_default = false");
  const f = await kit.firm({ isDefault: true });
  const { reviewer, authId } = await f.addReviewer();
  const owner = await createUser(pool);
  const v = await kit.frozen(owner);
  const b = await kit.buy(owner, "STANDARD_REVIEW", v.versionId);
  const req = (await pool.query("select id from review_requests where order_id = $1", [b.order_id])).rows[0].id as string;
  await pool.query("select assign_review($1, $2, $3, $4)", [f.coordinator, req, reviewer, NOW]);
  return { f, reviewer, authId, owner, v, req };
}
const start = (c: Ctx, who = c.reviewer) => pool.query("select * from start_review($1, $2, $3)", [who, c.req, NOW]);
const draft = async (c: Ctx, rev: number, scope = "Klausul kerahasiaan dan jangka waktu", summary = "") =>
  (await pool.query("select save_report_draft($1, $2, $3, $4, 'Asumsi data benar', $5, $6) as r", [c.reviewer, c.req, rev, scope, summary, NOW])).rows[0].r as number;
const note = async (c: Ctx, rev: number, over: object = {}) =>
  (await pool.query("select * from upsert_note($1, $2, $3, $4, $5)", [c.reviewer, c.req, rev, JSON.stringify({ title: "Jangka waktu", finding: "Tidak jelas", severity: "MINOR", actionable: true, recommended_action: "Perjelas", ...over }), NOW])).rows[0] as { revision: number; note_no: number };
const publish = (c: Ctx, rev: number, outcome: string, opts: { noNotes?: boolean; attest?: boolean; who?: string } = {}) =>
  pool.query("select * from publish_standard($1, $2, $3, $4, $5, $6, true, $7)", [opts.who ?? c.reviewer, c.req, rev, outcome, opts.noNotes ?? false, opts.attest ?? true, NOW]);
const reqRow = async (c: Ctx) => (await pool.query("select * from review_requests where id = $1", [c.req])).rows[0];
const verifCount = async (c: Ctx) => Number((await pool.query("select count(*) from document_verifications where request_id = $1", [c.req])).rows[0].count);

describe("alur lengkap", () => {
  it("WITH_NOTES menerbitkan tepat satu verifikasi LEGAL dengan hash versi; catatan PUBLISHED; outbox terkirim", async () => {
    const c = await setup();
    const s = (await start(c)).rows[0];
    expect(s.version_text).toContain("Perjanjian Kerahasiaan");
    let rev = await draft(c, s.revision);
    rev = (await note(c, rev)).revision;
    const r = (await publish(c, rev, "WITH_NOTES")).rows[0];
    expect(r.status).toBe("WITH_NOTES");
    expect(r.code.length).toBeGreaterThanOrEqual(40);
    expect(await verifCount(c)).toBe(1);
    const hash = (await pool.query("select sha256 from document_versions where id = $1", [c.v.versionId])).rows[0].sha256;
    const dv = (await pool.query("select * from document_verifications where request_id = $1", [c.req])).rows[0];
    expect([dv.kind, dv.sha256, dv.status, dv.outcome]).toEqual(["LEGAL", hash, "ACTIVE", "WITH_NOTES"]);
    expect((await pool.query("select status from legal_notes where report_id = (select id from review_reports where request_id = $1)", [c.req])).rows[0].status).toBe("PUBLISHED");
    expect((await reqRow(c)).status).toBe("COMPLETED");
    expect((await pool.query("select count(*) from outbox_events where dedupe_key = $1", [`review_completed:${c.req}`])).rows[0].count).toBe("1");
    expect((await pool.query("select count(*) from audit_events where entity_id = $1 and event_type in ('review_file_access','review_completed')", [c.req])).rows[0].count).toBe("2");
  });

  it("WITHIN_SCOPE butuh deklarasi dan tanpa catatan", async () => {
    const c = await setup();
    const s = (await start(c)).rows[0];
    const rev = await draft(c, s.revision);
    await expect(publish(c, rev, "WITHIN_SCOPE")).rejects.toThrow(/NO_NOTES_DECLARATION_REQUIRED/);
    const r = (await publish(c, rev, "WITHIN_SCOPE", { noNotes: true })).rows[0];
    expect(r.status).toBe("WITHIN_SCOPE");
    expect(await verifCount(c)).toBe(1);
  });

  it("WITHIN_SCOPE dengan catatan ditolak; WITH_NOTES tanpa catatan ditolak", async () => {
    const c = await setup();
    const s = (await start(c)).rows[0];
    const rev = await draft(c, s.revision);
    await expect(publish(c, rev, "WITH_NOTES")).rejects.toThrow(/NOTES_REQUIRED/);
    const n = await note(c, rev);
    await expect(publish(c, n.revision, "WITHIN_SCOPE", { noNotes: true })).rejects.toThrow(/NOTES_PRESENT/);
    expect(await verifCount(c)).toBe(0);
  });

  it("catatan aktionabel butuh tindakan; MATERIAL/CRITICAL butuh dasar dan eskalasi", async () => {
    const c = await setup();
    const s = (await start(c)).rows[0];
    const rev = await draft(c, s.revision);
    const a = await note(c, rev, { actionable: true, recommended_action: null });
    await expect(publish(c, a.revision, "WITH_NOTES")).rejects.toThrow(/NOTE_ACTION_REQUIRED/);
    const b = await note(c, a.revision, { note_no: a.note_no, recommended_action: "Ubah klausul", severity: "MATERIAL" });
    await expect(publish(c, b.revision, "WITH_NOTES")).rejects.toThrow(/NOTE_RATIONALE_REQUIRED/);
    const d = await note(c, b.revision, { note_no: a.note_no, recommended_action: "Ubah klausul", severity: "MATERIAL", rationale: "Risiko sengketa", escalation: "Konsultasi lanjutan" });
    await expect(publish(c, d.revision, "WITH_NOTES")).resolves.toBeTruthy();
  });

  it("tanpa atestasi → ATTESTATION_REQUIRED tanpa efek; lingkup kosong ditolak", async () => {
    const c = await setup();
    const s = (await start(c)).rows[0];
    let rev = await draft(c, s.revision, "");
    rev = (await note(c, rev)).revision;
    await expect(publish(c, rev, "WITH_NOTES", { attest: false })).rejects.toThrow(/ATTESTATION_REQUIRED/);
    await expect(publish(c, rev, "WITH_NOTES")).rejects.toThrow(/SCOPE_REQUIRED/);
    expect(await verifCount(c)).toBe(0);
    expect((await reqRow(c)).status).toBe("IN_REVIEW");
  });

  it("revisi basi → STALE_REVISION", async () => {
    const c = await setup();
    const s = (await start(c)).rows[0];
    const rev = await draft(c, s.revision);
    await expect(draft(c, s.revision)).rejects.toThrow(/STALE_REVISION/);
    await expect(publish(c, rev - 1 < 0 ? 99 : rev + 5, "WITHIN_SCOPE", { noNotes: true })).rejects.toThrow(/STALE_REVISION/);
  });

  it("panggilan ganda dengan revisi sama → satu verifikasi dan hasil sama", async () => {
    const c = await setup();
    const s = (await start(c)).rows[0];
    const rev = await draft(c, s.revision);
    const first = (await publish(c, rev, "WITHIN_SCOPE", { noNotes: true })).rows[0];
    const second = (await publish(c, rev, "WITHIN_SCOPE", { noNotes: true })).rows[0];
    expect(second.code).toBe(first.code);
    expect(await verifCount(c)).toBe(1);
    const both = await Promise.allSettled([publish(c, rev, "WITHIN_SCOPE", { noNotes: true }), publish(c, rev, "WITHIN_SCOPE", { noNotes: true })]);
    expect(both.every((x) => x.status === "fulfilled")).toBe(true);
    expect(await verifCount(c)).toBe(1);
  });

  it("INCONCLUSIVE tanpa badge namun permintaan selesai dan pemilik diberi tahu; butuh ringkasan", async () => {
    const c = await setup();
    const s = (await start(c)).rows[0];
    const rev = await draft(c, s.revision, "Lingkup", "");
    await expect(publish(c, rev, "INCONCLUSIVE")).rejects.toThrow(/SUMMARY_REQUIRED/);
    const rev2 = await draft(c, rev, "Lingkup", "Bukti tidak memadai untuk menyimpulkan");
    const r = (await publish(c, rev2, "INCONCLUSIVE")).rows[0];
    expect([r.status, r.verification_id]).toEqual(["INCONCLUSIVE", null]);
    expect(await verifCount(c)).toBe(0);
    const rq = await reqRow(c);
    expect([rq.status, rq.outcome]).toEqual(["COMPLETED", "INCONCLUSIVE"]);
  });

  it("DECLINED menjadikan permintaan DECLINED tanpa badge dan mengganti pembayaran dengan satu kredit review", async () => {
    const c = await setup();
    const s = (await start(c)).rows[0];
    const rev = await draft(c, s.revision, "Lingkup", "Di luar bidang kami");
    await publish(c, rev, "DECLINED");
    expect((await reqRow(c)).status).toBe("DECLINED");
    expect(await verifCount(c)).toBe(0);
    expect((await pool.query("select status from orders where id = (select order_id from review_requests where id = $1)", [c.req])).rows[0].status).toBe("CANCELLED");
    const again = await kit.order(c.owner, "STANDARD_REVIEW", c.v.versionId, at(5));
    expect([again.amount_idr, again.status]).toEqual([0, "PAID"]);
  });
});

describe("kewenangan dan integritas", () => {
  it("reviewer lain, koordinator, admin, pemilik → FORBIDDEN pada start/draft/publish", async () => {
    const c = await setup();
    const other = await c.f.addReviewer();
    for (const who of [other.reviewer, c.f.coordinator, c.f.admin, c.owner]) {
      await expect(start(c, who)).rejects.toThrow(/FORBIDDEN/);
      await expect(publish(c, 0, "WITHIN_SCOPE", { who, noNotes: true })).rejects.toThrow(/FORBIDDEN/);
    }
    expect(await verifCount(c)).toBe(0);
  });

  it("otorisasi dicabut di tengah jalan → REVIEWER_NOT_AUTHORIZED dan tidak ada verifikasi", async () => {
    const c = await setup();
    const s = (await start(c)).rows[0];
    const rev = await draft(c, s.revision);
    await pool.query("select admin_revoke_authorization($1, $2, $3)", [c.f.admin, c.authId, NOW]);
    await expect(publish(c, rev, "WITHIN_SCOPE", { noNotes: true })).rejects.toThrow(/REVIEWER_NOT_AUTHORIZED/);
    await expect(start(c)).rejects.toThrow(/REVIEWER_NOT_AUTHORIZED/);
    expect(await verifCount(c)).toBe(0);
  });

  it("hash versi tidak cocok → VERSION_MISMATCH tanpa verifikasi", async () => {
    const c = await setup();
    const s = (await start(c)).rows[0];
    const rev = await draft(c, s.revision);
    await pool.query("update review_requests set version_sha256 = $2 where id = $1", [c.req, "d".repeat(64)]);
    await expect(publish(c, rev, "WITHIN_SCOPE", { noNotes: true })).rejects.toThrow(/VERSION_MISMATCH/);
    await expect(start(c)).rejects.toThrow(/VERSION_MISMATCH/);
    expect(await verifCount(c)).toBe(0);
  });

  it("laporan FINAL dan catatan PUBLISHED tidak dapat diubah atau dihapus", async () => {
    const c = await setup();
    const s = (await start(c)).rows[0];
    let rev = await draft(c, s.revision);
    rev = (await note(c, rev)).revision;
    await publish(c, rev, "WITH_NOTES");
    await expect(pool.query("update review_reports set summary = 'x' where request_id = $1", [c.req])).rejects.toThrow(/immutable/);
    await expect(pool.query("update legal_notes set title = 'x' where report_id in (select id from review_reports where request_id = $1)", [c.req])).rejects.toThrow(/immutable/);
    await expect(pool.query("delete from legal_notes where report_id in (select id from review_reports where request_id = $1)", [c.req])).rejects.toThrow(/immutable/);
    await expect(draft(c, rev)).rejects.toThrow(/FORBIDDEN/);
  });

  it("pemilik hanya melihat catatan PUBLISHED lewat get_review_for_owner; catatan draf tidak terlihat", async () => {
    const c = await setup();
    const s = (await start(c)).rows[0];
    let rev = await draft(c, s.revision, "Lingkup rahasia reviewer");
    rev = (await note(c, rev, { title: "CATATAN-DRAF" })).revision;
    const before = (await pool.query("select * from get_review_for_owner($1, $2)", [c.owner, c.req])).rows[0];
    expect(before.notes).toEqual([]);
    expect(before.scope).toBeNull();
    expect(JSON.stringify(before)).not.toContain("CATATAN-DRAF");
    await publish(c, rev, "WITH_NOTES");
    const after = (await pool.query("select * from get_review_for_owner($1, $2)", [c.owner, c.req])).rows[0];
    expect(after.notes).toHaveLength(1);
    expect(after.notes[0].title).toBe("CATATAN-DRAF");
    expect((await pool.query("select * from get_review_for_owner($1, $2)", [await createUser(pool), c.req])).rows).toHaveLength(0);
  });

  it("catatan otoritas (snapshot) tersimpan di verifikasi: id otorisasi, lingkup, masa berlaku, atestasi", async () => {
    const c = await setup();
    const s = (await start(c)).rows[0];
    const rev = await draft(c, s.revision);
    await publish(c, rev, "WITHIN_SCOPE", { noNotes: true });
    const issuer = (await pool.query("select issuer from document_verifications where request_id = $1", [c.req])).rows[0].issuer;
    expect(issuer.authorization_id).toBe(c.authId);
    expect(issuer.scope_note).toBe("Kontrak komersial");
    expect([issuer.valid_from, issuer.valid_to, issuer.attested]).toEqual(["2026-01-01", "2027-12-31", true]);
    expect(issuer.firm_id).toBe(c.f.firmId);
  });

  it("ekspor memilih verifikasi hukum aktif walau analisis AI yang lebih baru ada", async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const JSZip = (await import("jszip")).default;
    const { createFsBlobStore } = await import("@/lib/documents/blob");
    const { createPgDocumentsService } = await import("@/lib/documents/service");
    const blob = createFsBlobStore(mkdtempSync(path.join(tmpdir(), "pub-")));
    const svc = createPgDocumentsService(pool, { ALLOW_UNAPPROVED_TEMPLATES: "true", NODE_ENV: "test" }, { blob });
    const c = await setup();
    const s = (await start(c)).rows[0];
    const rev = await draft(c, s.revision);
    const pub = (await publish(c, rev, "WITHIN_SCOPE", { noNotes: true })).rows[0];
    const sha = (await pool.query("select sha256 from document_versions where id = $1", [c.v.versionId])).rows[0].sha256;
    const rep = (await pool.query("insert into ai_review_reports (user_id, logical_request_id, version_ref, sha256, report_json, analyzer_policy_version) values ($1, gen_random_uuid(), $2, $3, '{}', 'p1') returning id", [c.owner, c.v.versionId, sha])).rows[0].id;
    const ai = (await pool.query("select * from issue_ai_verification($1, $2, now())", [c.owner, rep])).rows[0];
    const e = (await svc.exportVersion(c.owner, c.v.versionId, "DOCX"))!;
    const row = (await pool.query("select storage_path from document_exports where id = $1", [e.exportId])).rows[0];
    const xml = await (await JSZip.loadAsync((await blob.get(row.storage_path))!)).file("word/document.xml")!.async("string");
    expect(xml).toContain(pub.code);
    expect(xml).not.toContain(ai.code);
  });
});

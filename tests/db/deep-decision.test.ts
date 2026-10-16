import { afterAll, describe, expect, it } from "vitest";
import { asUser, createUser, getPool } from "./helpers";
import { makeKit, NOW } from "./phase3-helpers";

const pool = getPool();
afterAll(() => pool.end());
const kit = makeKit(pool);
const ITEMS = ["M1", "M2", "M3", "M4", "M5", "M6", "M7"];

async function approveRubric() {
  const admin = await kit.admin();
  await pool.query("select admin_approve_rubric($1, 'v8-proposed', 'Persetujuan mitra #1', $2)", [admin, NOW]);
}

type Setup = Awaited<ReturnType<typeof prepare>>;
// Deep berbayar, ditugaskan, dan dikerjakan sampai siap diputuskan (dapat dilucuti per langkah lewat opsi).
async function prepare(o: { extraNote?: boolean; skipExtra?: boolean; skipChecklist?: string[]; failItem?: string; unknownItem?: string; noEvidenceItem?: string; disposition?: "RESOLVED" | "UNRESOLVED" | "NONE"; severity?: "MINOR" | "MATERIAL"; rubric?: boolean } = {}) {
  if (o.rubric !== false) await approveRubric();
  const c = await kit.completedStandard({ severity: o.severity ?? "MATERIAL", extraNote: o.extraNote });
  const b = await kit.buy(c.owner, "DEEP_REVIEW", c.req);
  const deep = (await pool.query("select * from deep_requests where order_id = $1", [b.order_id])).rows[0];
  await pool.query("select assign_deep($1, $2, $3, $4)", [c.f.coordinator, deep.id, c.r.reviewer, NOW]);
  const rv = c.r.reviewer;
  const s = (await pool.query("select * from start_deep($1, $2, $3)", [rv, deep.id, NOW])).rows[0];
  let rev: number = s.revision;
  const bump = async (sql: string, args: unknown[]) => { rev = (await pool.query(sql, [rv, deep.id, rev, ...args, NOW])).rows[0].r as number; };
  await bump("select save_deep_draft($1, $2, $3, $4, $5, $6) as r", [o.skipExtra ? "" : "Pemeriksaan identitas dan kewenangan para pihak", "Ringkasan pemeriksaan tambahan"]);
  if (o.disposition !== "NONE") await bump("select set_disposition($1, $2, $3, 1, $4, $5, $6) as r", [o.disposition ?? "RESOLVED", "Klausul diperbaiki di versi baru"]);
  for (const item of ITEMS) {
    if (o.skipChecklist?.includes(item)) continue;
    const result = item === o.failItem ? "FAIL" : item === o.unknownItem ? "UNKNOWN" : "PASS";
    await bump("select set_checklist($1, $2, $3, $4, $5, $6, $7, $8) as r", [item, result, "Penalaran " + item, item === o.noEvidenceItem ? "" : "Bukti " + item]);
  }
  const decide = (decision: string, over: { attest?: boolean; reason?: string; who?: string; revision?: number } = {}) =>
    pool.query("select * from decide_deep($1, $2, $3, $4, $5, $6, $7)", [over.who ?? rv, deep.id, over.revision ?? rev, decision, over.reason ?? null, over.attest ?? true, NOW]);
  const enhancedCount = async () => Number((await pool.query("select count(*) from document_verifications where kind = 'LEGAL_ENHANCED' and request_id = $1", [c.req])).rows[0].count);
  return { c, b, deep, rv, rev, decide, enhancedCount };
}
const row = async (s: Setup) => (await pool.query("select * from deep_requests where id = $1", [s.deep.id])).rows[0];

describe("keputusan APPROVE", () => {
  it("semua penjaga terpenuhi → tepat satu Enhanced dengan hash versi; induk tetap ACTIVE; laporan FINAL; outbox", async () => {
    const s = await prepare();
    const r = (await s.decide("APPROVE")).rows[0];
    expect(r.outcome).toBe("ENHANCED_APPROVED");
    expect(r.code.length).toBeGreaterThanOrEqual(40);
    expect(await s.enhancedCount()).toBe(1);
    const dv = (await pool.query("select * from document_verifications where code = $1", [r.code])).rows[0];
    const hash = (await pool.query("select sha256 from document_versions where id = $1", [s.c.v.versionId])).rows[0].sha256;
    expect([dv.kind, dv.sha256, dv.status, dv.parent_verification_id]).toEqual(["LEGAL_ENHANCED", hash, "ACTIVE", s.c.verificationId]);
    expect(dv.issuer).toMatchObject({ reviewer_id: s.rv, rubric_version: "v8-proposed", attested: true, deep_id: s.deep.id });
    expect((await pool.query("select status from document_verifications where id = $1", [s.c.verificationId])).rows[0].status).toBe("ACTIVE");
    const d = await row(s);
    expect([d.status, d.outcome]).toEqual(["COMPLETED", "ENHANCED_APPROVED"]);
    expect((await pool.query("select count(*) from outbox_events where dedupe_key = $1", [`deep_completed:${s.deep.id}`])).rows[0].count).toBe("1");
  });

  it("panggilan ulang idempoten (satu Enhanced); laporan FINAL dan checklist tidak dapat diubah", async () => {
    const s = await prepare();
    const a = (await s.decide("APPROVE")).rows[0];
    const b = (await s.decide("APPROVE")).rows[0];
    expect(b.code).toBe(a.code);
    expect(await s.enhancedCount()).toBe(1);
    await expect(pool.query("update deep_reports set summary = 'x' where deep_id = $1", [s.deep.id])).rejects.toThrow(/immutable/);
    await expect(pool.query("update deep_checklist set result = 'FAIL' where report_id = (select id from deep_reports where deep_id = $1)", [s.deep.id])).rejects.toThrow(/immutable/);
    await expect(pool.query("delete from deep_dispositions where report_id = (select id from deep_reports where deep_id = $1)", [s.deep.id])).rejects.toThrow(/immutable/);
  });
});

describe("penjaga negatif (policy-vectors)", () => {
  const blocked = async (s: Setup, re: RegExp) => {
    await expect(s.decide("APPROVE")).rejects.toThrow(re);
    expect(await s.enhancedCount()).toBe(0);
    expect((await row(s)).status).toBe("IN_REVIEW");
  };
  it("NO_EXTRA_WORK / PAYMENT_ONLY: tanpa pekerjaan tambahan tercatat", async () => blocked(await prepare({ skipExtra: true }), /NO_EXTRA_WORK/));
  it("MATERIAL_FAIL", async () => blocked(await prepare({ failItem: "M3" }), /MATERIAL_FAIL/));
  it("MATERIAL_UNKNOWN", async () => blocked(await prepare({ unknownItem: "M2" }), /MATERIAL_UNKNOWN/));
  it("MISSING_EVIDENCE (checklist PASS tanpa bukti)", async () => blocked(await prepare({ noEvidenceItem: "M1" }), /MISSING_EVIDENCE/));
  it("checklist tidak lengkap", async () => blocked(await prepare({ skipChecklist: ["M5"] }), /CHECKLIST_INCOMPLETE/));
  it("disposisi catatan induk hilang", async () => blocked(await prepare({ disposition: "NONE" }), /DISPOSITION_MISSING/));
  it("UNRESOLVED_MATERIAL_NOTE", async () => blocked(await prepare({ disposition: "UNRESOLVED" }), /UNRESOLVED_MATERIAL_NOTE/));
  it("UNAPPROVED_RUBRIC", async () => {
    await pool.query("delete from rubric_approvals");
    await blocked(await prepare({ rubric: false }), /UNAPPROVED_RUBRIC/);
  });
  it("NO_ATTESTATION", async () => {
    const s = await prepare();
    await expect(s.decide("APPROVE", { attest: false })).rejects.toThrow(/ATTESTATION_REQUIRED/);
    expect(await s.enhancedCount()).toBe(0);
  });
  it("STALE_HASH: hash versi pada permintaan berubah", async () => {
    const s = await prepare();
    await pool.query("update deep_requests set version_sha256 = $2 where id = $1", [s.deep.id, "a".repeat(64)]);
    await expect(s.decide("APPROVE")).rejects.toThrow(/VERSION_MISMATCH/);
    expect(await s.enhancedCount()).toBe(0);
  });
  it("revisi basi → STALE_REVISION", async () => {
    const s = await prepare();
    await expect(s.decide("APPROVE", { revision: s.rev - 1 })).rejects.toThrow(/STALE_REVISION/);
  });
  it("induk dicabut sebelum keputusan: pekerjaan ditahan dan penugasan berakhir, sehingga reviewer tidak dapat memutuskan", async () => {
    const s = await prepare();
    await pool.query("select revoke_verification($1, $2, 'ERROR', null, $3)", [s.c.f.admin, s.c.verificationId, NOW]);
    expect((await row(s)).status).toBe("ON_HOLD");
    await expect(s.decide("APPROVE")).rejects.toThrow(/FORBIDDEN/);
    expect(await s.enhancedCount()).toBe(0);
  });
  it("UNAUTHORIZED_REVIEWER: otorisasi dicabut di tengah jalan; reviewer lain; koordinator; admin; pemilik", async () => {
    const s = await prepare();
    for (const who of [await createUser(pool), s.c.f.coordinator, s.c.f.admin, s.c.owner]) {
      await expect(s.decide("APPROVE", { who })).rejects.toThrow(/FORBIDDEN/);
    }
    await pool.query("select admin_revoke_authorization($1, $2, $3)", [s.c.f.admin, s.c.r.authId, NOW]);
    await expect(s.decide("APPROVE")).rejects.toThrow(/REVIEWER_NOT_AUTHORIZED/);
    expect(await s.enhancedCount()).toBe(0);
  });
  it("N_A ditolak untuk M4, M6, M7 (wajib)", async () => {
    const s = await prepare();
    await expect(pool.query("select set_checklist($1, $2, $3, 'M4', 'N_A', 'alasan', '', $4)", [s.rv, s.deep.id, s.rev, NOW])).rejects.toThrow(/MANDATORY_ITEM/);
  });
});

describe("penjaga tambahan setelah review", () => {
  it("catatan MATERIAL/CRITICAL non-aktionabel tanpa disposisi memblokir Enhanced", async () => {
    const s = await prepare({ extraNote: true });
    await expect(s.decide("APPROVE")).rejects.toThrow(/DISPOSITION_MISSING/);
    expect(await s.enhancedCount()).toBe(0);
  });
  it("PAYMENT_NOT_VERIFIED: pembayaran tidak lagi VERIFIED saat keputusan", async () => {
    const s = await prepare();
    await pool.query("update payments set status = 'DISPUTED' where order_id = $1", [s.deep.order_id]);
    await expect(s.decide("APPROVE")).rejects.toThrow(/PAYMENT_NOT_VERIFIED/);
    expect(await s.enhancedCount()).toBe(0);
  });
  it("REVOKED_PARENT langsung pada penjaga: verifikasi induk ditangguhkan sementara permintaan tetap IN_REVIEW", async () => {
    const s = await prepare();
    await pool.query("update document_verifications set status = 'SUSPENDED' where id = $1", [s.c.verificationId]);
    expect((await row(s)).status).toBe("IN_REVIEW");
    await expect(s.decide("APPROVE")).rejects.toThrow(/REVOKED_PARENT/);
    expect(await s.enhancedCount()).toBe(0);
  });
});

describe("keputusan selain APPROVE", () => {
  it("DENY/INCONCLUSIVE/REFER_SPECIAL butuh alasan, menyelesaikan pekerjaan, dan tidak menerbitkan apa pun", async () => {
    for (const [decision, outcome] of [["DENY", "COMPLETED_WITH_NOTES"], ["INCONCLUSIVE", "INCONCLUSIVE"], ["REFER_SPECIAL", "REFERRED_SPECIAL_CASE"]] as const) {
      const s = await prepare({ failItem: "M3" });
      await expect(s.decide(decision)).rejects.toThrow(/REASON_REQUIRED/);
      const r = (await s.decide(decision, { reason: "Kriteria material M3 tidak terpenuhi" })).rows[0];
      expect([r.outcome, r.verification_id]).toEqual([outcome, null]);
      expect(await s.enhancedCount()).toBe(0);
      expect((await row(s)).status).toBe("COMPLETED");
    }
  });
});

describe("akses", () => {
  it("pemilik hanya melihat laporan deep FINAL; draf tidak terlihat; admin_approve_rubric non-admin FORBIDDEN; klien tidak dapat memanggil", async () => {
    const s = await prepare();
    const before = (await pool.query("select * from get_deep_for_owner($1, $2)", [s.c.owner, s.deep.id])).rows[0];
    expect([before.summary, before.extra_work, before.dispositions]).toEqual([null, null, []]);
    await s.decide("APPROVE");
    const after = (await pool.query("select * from get_deep_for_owner($1, $2)", [s.c.owner, s.deep.id])).rows[0];
    expect(after.dispositions).toHaveLength(1);
    expect(after.verification_code).toHaveLength(48);
    expect((await pool.query("select * from get_deep_for_owner($1, $2)", [await createUser(pool), s.deep.id])).rows).toHaveLength(0);
    await expect(pool.query("select admin_approve_rubric($1, 'x', 'ref', $2)", [s.c.owner, NOW])).rejects.toThrow(/FORBIDDEN/);
    await expect(asUser(pool, s.c.owner, (c) => c.query("select * from decide_deep($1, $2, 0, 'APPROVE', null, true, now())", [s.c.owner, s.deep.id]))).rejects.toThrow(/permission denied/);
    await expect(asUser(pool, s.c.owner, (c) => c.query("select * from deep_reports"))).rejects.toThrow(/permission denied/);
  });
});

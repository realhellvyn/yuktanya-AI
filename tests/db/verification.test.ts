import { afterAll, describe, expect, it } from "vitest";
import { asUser, createUser, getPool } from "./helpers";
import { makeKit, NOW } from "./phase3-helpers";

const pool = getPool();
afterAll(() => pool.end());
const kit = makeKit(pool);

async function aiReport(u: string, versionId: string, hash?: string) {
  const sha = hash ?? (await pool.query("select sha256 from document_versions where id = $1", [versionId])).rows[0].sha256;
  const { rows } = await pool.query(
    "insert into ai_review_reports (user_id, logical_request_id, version_ref, sha256, report_json, analyzer_policy_version) values ($1, gen_random_uuid(), $2, $3, '{}', 'p1') returning id",
    [u, versionId, sha],
  );
  return rows[0].id as string;
}
const issue = async (u: string, rep: string) => (await pool.query("select * from issue_ai_verification($1, $2, $3)", [u, rep, NOW])).rows[0] as { verification_id: string; code: string };
const legacyAi = async (u: string, versionId: string) => {
  const rep = await aiReport(u, versionId);
  const sha = (await pool.query("select sha256 from document_versions where id = $1", [versionId])).rows[0].sha256;
  await pool.query("insert into document_verifications (kind, version_id, sha256, outcome, policy_version, code, ai_report_id, issued_at) values ('AI', $1, $2, 'COMPLETED', 'p1', $3, $4, now())",
    [versionId, sha, "L".repeat(20) + Math.random().toString(36).slice(2).padEnd(28, "x"), rep]);
};
const lookup = async (code: string) => (await pool.query("select * from public_verification($1)", [code])).rows[0];

describe("verifikasi AI dan proyeksi publik", () => {
  it("kode acak ≥ 40 karakter dan unik; proyeksi publik hanya berisi bidang minimal", async () => {
    const u = await kit.member();
    const v1 = await kit.uploaded(u);
    const v2 = await kit.uploaded(u);
    const a = await issue(u, await aiReport(u, v1.versionId));
    const b = await issue(u, await aiReport(u, v2.versionId));
    expect(a.code.length).toBeGreaterThanOrEqual(40);
    expect(a.code).not.toBe(b.code);
    const pub = await lookup(a.code);
    expect(Object.keys(pub).sort()).toEqual(["issued_at", "kind", "outcome", "scope_summary", "sha256", "status"]);
    expect(pub.status).toBe("ACTIVE");
    expect(pub.kind).toBe("AI");
    expect(pub.scope_summary).toBeNull();
    const hash = (await pool.query("select sha256 from document_versions where id = $1", [v1.versionId])).rows[0].sha256;
    expect(pub.sha256).toBe(hash);
    const text = JSON.stringify(pub);
    expect(text).not.toContain("Sinta");
    expect(text).not.toContain("ZZ-RAHASIA");
  });

  it("kode tak dikenal → NOT_FOUND tanpa bidang lain", async () => {
    const pub = await lookup("x".repeat(48));
    expect(pub.status).toBe("NOT_FOUND");
    expect(pub.kind).toBeNull();
    expect(pub.sha256).toBeNull();
  });

  it("issue_ai_verification: laporan milik orang lain, hash tak cocok, atau tidak ada → ditolak; panggilan ulang idempoten", async () => {
    const u = await createUser(pool);
    const other = await createUser(pool);
    const v = await kit.uploaded(u);
    const rep = await aiReport(u, v.versionId);
    await expect(issue(other, rep)).rejects.toThrow(/NOT_FOUND/);
    await expect(issue(u, await aiReport(u, v.versionId, "a".repeat(64)))).rejects.toThrow(/VERSION_MISMATCH/);
    await expect(issue(u, "00000000-0000-0000-0000-000000000000")).rejects.toThrow(/NOT_FOUND/);
    const first = await issue(u, rep);
    expect((await issue(u, rep)).verification_id).toBe(first.verification_id);
    expect((await pool.query("select count(*) from document_verifications where ai_report_id = $1", [rep])).rows[0].count).toBe("1");
  });

  it("Task 24 (A24 M5): dokumen template (dibuat dengan bantuan AI) tidak pernah mendapat AI Verified — dijaga di DB", async () => {
    const u = await createUser(pool);
    const v = await kit.frozen(u);
    const rep = await aiReport(u, v.versionId);
    await expect(issue(u, rep)).rejects.toThrow(/NOT_UPLOAD/);
    expect((await pool.query("select count(*)::int as n from document_verifications where version_id = $1", [v.versionId])).rows[0].n).toBe(0);
    // Unggahan milik pengguna yang sama tetap dapat diterbitkan.
    const m = await kit.member();
    const up = await kit.uploaded(m);
    expect((await issue(m, await aiReport(m, up.versionId))).code.length).toBeGreaterThanOrEqual(40);
  });

  it("versi yang diedit tidak mewarisi verifikasi", async () => {
    const u = await createUser(pool);
    const v = await kit.frozen(u);
    // Dokumen unggahan tidak dapat diberi versi baru; rekaman AI pada versi template ini ditulis langsung (bentuk rekaman lama
    // sebelum migrasi 41) karena yang diuji adalah pewarisan ke versi baru, bukan penerbitan.
    await legacyAi(u, v.versionId);
    const d = (await kit.docs.get(u, v.documentId))!;
    await kit.docs.saveDraft(u, v.documentId, { ...(d.draft.data as object), purpose: "Berbeda" } as never, d.draft.revision);
    const r2 = await kit.docs.freeze(u, v.documentId, "k-edit-123456789", NOW);
    if (!r2.ok) throw new Error("freeze gagal");
    expect((await pool.query("select * from verifications_for_version($1, $2)", [u, r2.versionId])).rows).toHaveLength(0);
    expect((await pool.query("select * from verifications_for_version($1, $2)", [u, v.versionId])).rows).toHaveLength(1);
  });

  it("verifications_for_version hanya untuk pemilik", async () => {
    const u = await createUser(pool);
    const other = await createUser(pool);
    const v = await kit.uploaded(u);
    await issue(u, await aiReport(u, v.versionId));
    expect((await pool.query("select * from verifications_for_version($1, $2)", [other, v.versionId])).rows).toHaveLength(0);
  });
});

describe("pencabutan", () => {
  it("pengguna biasa, pemilik, koordinator → FORBIDDEN; admin → REVOKED seketika; berulang tidak menambah baris", async () => {
    const f = await kit.firm();
    const u = await createUser(pool);
    const v = await kit.uploaded(u);
    const a = await issue(u, await aiReport(u, v.versionId));
    for (const actor of [u, f.coordinator, await createUser(pool)]) {
      await expect(pool.query("select revoke_verification($1, $2, 'ERROR', 'x', $3)", [actor, a.verification_id, NOW])).rejects.toThrow(/FORBIDDEN/);
    }
    await pool.query("select revoke_verification($1, $2, 'ERROR', 'alasan privat', $3)", [f.admin, a.verification_id, NOW]);
    expect((await lookup(a.code)).status).toBe("REVOKED");
    await pool.query("select revoke_verification($1, $2, 'ERROR', 'lagi', $3)", [f.admin, a.verification_id, NOW]);
    expect((await pool.query("select count(*) from verification_revocations where verification_id = $1", [a.verification_id])).rows[0].count).toBe("1");
    expect(JSON.stringify(await lookup(a.code))).not.toContain("alasan privat");
  });

  it("alasan tak dikenal ditolak; revokasi append-only; record verifikasi tidak dapat diubah selain status", async () => {
    const f = await kit.firm();
    const u = await createUser(pool);
    const v = await kit.uploaded(u);
    const a = await issue(u, await aiReport(u, v.versionId));
    await expect(pool.query("select revoke_verification($1, $2, 'BEBAS', null, $3)", [f.admin, a.verification_id, NOW])).rejects.toThrow(/INVALID_REASON/);
    await pool.query("select revoke_verification($1, $2, 'OTHER', null, $3)", [f.admin, a.verification_id, NOW]);
    await expect(pool.query("update verification_revocations set reason_code = 'ERROR'")).rejects.toThrow();
    await expect(pool.query("delete from verification_revocations")).rejects.toThrow();
    await expect(pool.query("update document_verifications set sha256 = $2 where id = $1", [a.verification_id, "b".repeat(64)])).rejects.toThrow(/immutable/);
    await expect(pool.query("delete from document_verifications where id = $1", [a.verification_id])).rejects.toThrow(/deleted/);
  });

  it("LEGAL tanpa permintaan review ditolak oleh constraint", async () => {
    const u = await createUser(pool);
    const v = await kit.frozen(u);
    const sha = (await pool.query("select sha256 from document_versions where id = $1", [v.versionId])).rows[0].sha256;
    await expect(pool.query("insert into document_verifications (kind, version_id, sha256, policy_version, code, issued_at) values ('LEGAL', $1, $2, 'v8', $3, now())", [v.versionId, sha, "c".repeat(48)])).rejects.toThrow();
  });

  it("penerbit/ruang lingkup publik tetap null sampai PUBLIC_ISSUER_DISCLOSURE aktif", async () => {
    const u = await createUser(pool);
    const v = await kit.uploaded(u);
    const a = await issue(u, await aiReport(u, v.versionId));
    await pool.query("update document_verifications set status = status where id = $1", [a.verification_id]);
    expect((await lookup(a.code)).scope_summary).toBeNull();
  });

  it("authenticated tidak dapat memanggil fungsi atau membaca tabel", async () => {
    const u = await createUser(pool);
    await expect(asUser(pool, u, (c) => c.query("select * from public_verification('x')"))).rejects.toThrow(/permission denied/);
    await expect(asUser(pool, u, (c) => c.query("select * from document_verifications"))).rejects.toThrow(/permission denied/);
    await expect(asUser(pool, u, (c) => c.query("select * from app_settings"))).rejects.toThrow(/permission denied/);
  });
});

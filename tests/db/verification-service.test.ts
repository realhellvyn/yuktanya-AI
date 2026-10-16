import { afterAll, describe, expect, it } from "vitest";
import { createPgVerificationService, VerificationError } from "@/lib/verification/service";
import { createUser, getPool } from "./helpers";
import { makeKit, NOW } from "./phase3-helpers";

const pool = getPool();
afterAll(() => pool.end());
const kit = makeKit(pool);
const svc = createPgVerificationService(pool);

describe("layanan verifikasi", () => {
  it("lookup: format kode salah dan kode tak dikenal → NOT_FOUND tanpa menyentuh DB; aktif → bidang minimal; dicabut → REVOKED", async () => {
    const u = await createUser(pool);
    const v = await kit.frozen(u);
    const sha = (await pool.query("select sha256 from document_versions where id = $1", [v.versionId])).rows[0].sha256;
    const rep = (await pool.query("insert into ai_review_reports (user_id, logical_request_id, version_ref, sha256, report_json, analyzer_policy_version) values ($1, gen_random_uuid(), $2, $3, '{}', 'p1') returning id", [u, v.versionId, sha])).rows[0].id;
    const { verificationId, code } = await svc.issueAi(u, rep, NOW);
    expect(await svc.lookup("x")).toEqual({ status: "NOT_FOUND" });
    expect(await svc.lookup("z".repeat(48))).toEqual({ status: "NOT_FOUND" });
    const ok = await svc.lookup(code);
    expect(ok).toMatchObject({ status: "ACTIVE", kind: "AI", sha256: sha, scopeSummary: null });
    expect(Object.keys(ok).sort()).toEqual(["issuedAt", "kind", "outcome", "scopeSummary", "sha256", "status", "textExtracted"]);
    expect(ok.status === "ACTIVE" && ok.textExtracted).toBe(false);
    const admin = await kit.admin();
    await expect(svc.revoke(u, verificationId, "ERROR", null, NOW)).rejects.toBeInstanceOf(VerificationError);
    await svc.revoke(admin, verificationId, "ERROR", "privat", NOW);
    expect((await svc.lookup(code)).status).toBe("REVOKED");
    expect((await svc.forVersion(u, v.versionId))[0].status).toBe("REVOKED");
    expect(await svc.forVersion(await createUser(pool), v.versionId)).toEqual([]);
  });

  it("issueAi: laporan orang lain → NOT_FOUND", async () => {
    await expect(svc.issueAi(await createUser(pool), "00000000-0000-4000-8000-000000000000", NOW)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

import type { Pool } from "pg";
import type { VerificationKind } from "@/lib/copy";

export type PublicVerificationResult =
  | { status: "NOT_FOUND" }
  | { status: "ACTIVE" | "REVOKED" | "SUSPENDED"; kind: VerificationKind; issuedAt: string; sha256: string; scopeSummary: string | null; outcome: string | null;
      // true bila versi berasal dari dokumen unggahan: kode adalah hash teks hasil pembacaan, bukan berkas asli.
      textExtracted: boolean };
export type VerificationView = {
  id: string; kind: VerificationKind; status: "ACTIVE" | "REVOKED" | "SUSPENDED"; outcome: string | null; code: string;
  sha256: string; issuedAt: string; scopeSummary: string | null;
};
export class VerificationError extends Error {
  constructor(readonly code: "NOT_FOUND" | "FORBIDDEN" | "INVALID_REASON" | "VERSION_MISMATCH" | "NOT_UPLOAD") {
    super(code);
    this.name = "VerificationError";
  }
}
const CODE = /^[A-Za-z0-9_-]{40,128}$/;
const REASONS = ["ERROR", "MISLEADING", "AUTHORITY_REVOKED", "OWNER_REQUEST", "OTHER"] as const;
export type RevokeReason = (typeof REASONS)[number];

export interface VerificationService {
  lookup(code: string): Promise<PublicVerificationResult>;
  forVersion(userId: string, versionId: string): Promise<VerificationView[]>;
  revoke(actorId: string, id: string, reason: RevokeReason, privateReason: string | null, now?: Date): Promise<void>;
  issueAi(userId: string, aiReportId: string, now?: Date): Promise<{ verificationId: string; code: string }>;
}

export function createPgVerificationService(pool: Pool): VerificationService {
  return {
    async lookup(code) {
      if (!CODE.test(code)) return { status: "NOT_FOUND" };
      const { rows } = await pool.query("select * from public_verification($1)", [code]);
      const r = rows[0];
      if (!r || r.status === "NOT_FOUND") return { status: "NOT_FOUND" };
      const up = await pool.query(
        "select exists (select 1 from document_verifications dv join document_uploads u on u.version_id = dv.version_id where dv.code = $1) as up",
        [code],
      );
      return {
        status: r.status, kind: r.kind, issuedAt: r.issued_at.toISOString(), sha256: r.sha256, scopeSummary: r.scope_summary ?? null, outcome: r.outcome ?? null,
        textExtracted: Boolean(up.rows[0]?.up),
      };
    },
    async forVersion(userId, versionId) {
      const { rows } = await pool.query("select * from verifications_for_version($1, $2)", [userId, versionId]);
      return rows.map((r) => ({
        id: r.id, kind: r.kind, status: r.status, outcome: r.outcome, code: r.code, sha256: r.sha256,
        issuedAt: r.issued_at.toISOString(), scopeSummary: r.scope_summary ?? null,
      }));
    },
    async revoke(actorId, id, reason, privateReason, now = new Date()) {
      if (!REASONS.includes(reason)) throw new VerificationError("INVALID_REASON");
      try {
        await pool.query("select revoke_verification($1, $2, $3, $4, $5)", [actorId, id, reason, privateReason, now]);
      } catch (e) {
        const m = e instanceof Error ? e.message : "";
        for (const c of ["NOT_FOUND", "FORBIDDEN", "INVALID_REASON"] as const) if (m.includes(c)) throw new VerificationError(c);
        throw e;
      }
    },
    async issueAi(userId, aiReportId, now = new Date()) {
      try {
        const { rows } = await pool.query("select * from issue_ai_verification($1, $2, $3)", [userId, aiReportId, now]);
        return { verificationId: rows[0].verification_id, code: rows[0].code };
      } catch (e) {
        const m = e instanceof Error ? e.message : "";
        for (const c of ["NOT_FOUND", "VERSION_MISMATCH", "NOT_UPLOAD"] as const) if (m.includes(c)) throw new VerificationError(c);
        throw e;
      }
    },
  };
}

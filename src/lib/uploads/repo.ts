import type { Pool } from "pg";
import type { SaveUploadInput, SaveUploadResult } from "./handler";
import type { UploadKind } from "./validate";

export type UploadMeta = {
  versionId: string; documentId: string; kind: UploadKind; filename: string; byteSize: number; originalSha256: string;
  pages: number | null; chars: number; riskLevel: "NORMAL" | "HIGH"; riskReasons: string[]; createdAt: string;
};

export function createPgUploadRepo(pool: Pool) {
  return {
    async save(i: SaveUploadInput): Promise<SaveUploadResult> {
      const { rows } = await pool.query("select * from create_upload($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)", [
        i.userId, i.key, i.title, i.canonical, i.kind, i.filename, i.byteSize, i.originalSha256, i.path, i.pages, i.chars, i.risk.level, i.risk.reasons, i.now,
      ]);
      const r = rows[0];
      if (r.status === "QUOTA_DOCUMENT") return { status: "QUOTA_DOCUMENT", resetAt: (r.reset_at as Date).toISOString() };
      return { status: r.status, documentId: r.document_id, versionId: r.version_id, sha256: r.sha256 };
    },

    // Metadata unggahan hanya untuk pemilik dokumen; dokumen template atau milik orang lain → null.
    async meta(userId: string, documentId: string): Promise<UploadMeta | null> {
      const { rows } = await pool.query(
        `select u.* from document_uploads u join documents d on d.id = u.document_id where u.document_id = $1 and d.owner_id = $2`,
        [documentId, userId],
      );
      const r = rows[0];
      if (!r) return null;
      return {
        versionId: r.version_id, documentId: r.document_id, kind: r.file_kind, filename: r.original_filename, byteSize: r.byte_size,
        originalSha256: r.original_sha256, pages: r.page_count, chars: r.char_count, riskLevel: r.risk_level, riskReasons: r.risk_reasons,
        createdAt: (r.created_at as Date).toISOString(),
      };
    },
  };
}

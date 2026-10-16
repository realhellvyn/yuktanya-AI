import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { BlobStore } from "./blob";
import { exportVerificationStatement, UPLOAD_HASH_NOTE, VERIFICATION_TITLES, type VerificationKind } from "@/lib/copy";
import { qrPng, verifyUrl } from "@/lib/verification/qr";
import { exportDocx, exportPdf, sha256Hex, type ExportVerification } from "./export";
import { canonicalize, parseCanonical, renderDocument, type RenderedDoc } from "./render";
import { getTemplate, TemplateNotApprovedError, TEMPLATES, type ApprovalCheck } from "./templates/registry";
import type { Category, Data, DocCategory } from "./types";

export class NotFoundError extends Error {
  constructor() {
    super("NOT_FOUND");
    this.name = "NotFoundError";
  }
}
export class StaleRevisionError extends Error {
  constructor() {
    super("STALE_REVISION");
    this.name = "StaleRevisionError";
  }
}

export class IntegrityError extends Error {
  constructor(message = "INTEGRITY_ERROR") {
    super(message);
    this.name = "IntegrityError";
  }
}

export type ExportFormat = "DOCX" | "PDF";
const FORMATS: Record<ExportFormat, { ext: string; contentType: string }> = {
  DOCX: { ext: "docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  PDF: { ext: "pdf", contentType: "application/pdf" },
};

export type FreezeResult =
  | { ok: true; versionId: string; versionNo: number; sha256: string; duplicate: boolean }
  | { ok: false; code: "VALIDATION_FAILED"; errors: Record<string, string> }
  | { ok: false; code: "DOCUMENT_DAILY_QUOTA_REACHED"; resetAt: string }
  | { ok: false; code: "TEMPLATE_NOT_APPROVED" };

export type VersionSummary = { id: string; versionNo: number; sha256: string; createdAt: string };
export type DocSummary = { id: string; category: DocCategory; title: string; createdAt: string; versionCount: number; latestVersionNo: number | null };
export type DocDetail = { id: string; category: DocCategory; title: string; draft: { data: Data; revision: number }; versions: VersionSummary[] };
export type VersionDetail = VersionSummary & { documentId: string; canonicalText: string; doc: RenderedDoc; structuredData: Data };

export interface DocumentsService {
  create(userId: string, category: Category, key: string): Promise<{ documentId: string }>;
  saveDraft(userId: string, documentId: string, data: Data, revision: number): Promise<{ revision: number }>;
  freeze(userId: string, documentId: string, key: string, now?: Date): Promise<FreezeResult>;
  list(userId: string): Promise<DocSummary[]>;
  get(userId: string, documentId: string): Promise<DocDetail | null>;
  getVersion(userId: string, versionId: string): Promise<VersionDetail | null>;
  clone(userId: string, versionId: string, key: string): Promise<{ documentId: string } | null>;
  exportVersion(userId: string, versionId: string, format: ExportFormat): Promise<{ exportId: string; sha256: string; byteSize: number } | null>;
  downloadExport(userId: string, exportId: string): Promise<{ bytes: Uint8Array; filename: string; contentType: string } | null>;
}

type Env = { ALLOW_UNAPPROVED_TEMPLATES?: string; NODE_ENV?: string };
type Deps = { isApproved?: ApprovalCheck; blob?: BlobStore };

const isNotFound = (e: unknown) => e instanceof Error && e.message.includes("NOT_FOUND");

export function createPgDocumentsService(pool: Pool, env: Env = process.env as Env, deps: Deps = {}): DocumentsService {
  const isApproved: ApprovalCheck =
    deps.isApproved ??
    (async (id, version, hash) => (await pool.query("select is_template_approved($1, $2, $3) as ok", [id, version, hash])).rows[0].ok);
  // Produksi selalu mewajibkan persetujuan, apa pun nilai ALLOW_UNAPPROVED_TEMPLATES.
  const allowUnapproved = env.ALLOW_UNAPPROVED_TEMPLATES === "true" && env.NODE_ENV !== "production";
  const template = (category: Category) => getTemplate(category, { allowUnapproved, isApproved });

  async function owned(userId: string, documentId: string) {
    const { rows } = await pool.query(
      `select d.id, d.category, d.title, dr.structured_data, dr.revision
         from documents d join document_drafts dr on dr.document_id = d.id
        where d.id = $1 and d.owner_id = $2`,
      [documentId, userId],
    );
    return rows[0] as { id: string; category: DocCategory; title: string; structured_data: Data; revision: number } | undefined;
  }
  // Draf template yang dapat diubah/dibekukan; dokumen unggahan (UPLOAD) hanya punya satu versi beku.
  async function ownedTemplate(userId: string, documentId: string) {
    const doc = await owned(userId, documentId);
    return doc && doc.category !== "UPLOAD" ? { ...doc, category: doc.category } : undefined;
  }

  const toVersion = (r: { id: string; version_no: number; sha256: string; created_at: Date }): VersionSummary => ({
    id: r.id, versionNo: r.version_no, sha256: r.sha256, createdAt: r.created_at.toISOString(),
  });

  const needBlob = (): BlobStore => {
    if (!deps.blob) throw new Error("Penyimpanan berkas belum dikonfigurasi");
    return deps.blob;
  };
  const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "dokumen";

  // Verifikasi AKTIF terbaru untuk versi ini (bila ada) ikut dicantumkan; versi yang dicabut atau diedit tidak membawa blok aktif.
  async function activeVerification(versionId: string, upload = false): Promise<ExportVerification | undefined> {
    const { rows } = await pool.query(
      `select kind, outcome, code, sha256 from document_verifications where version_id = $1 and status = 'ACTIVE'
        order by case kind when 'LEGAL_ENHANCED' then 0 when 'LEGAL' then 1 else 2 end, issued_at desc limit 1`,
      [versionId],
    );
    const r = rows[0];
    if (!r) return undefined;
    const url = verifyUrl(r.code);
    return {
      kindTitle: VERIFICATION_TITLES[r.kind as VerificationKind], statement: exportVerificationStatement(r.kind as VerificationKind, r.outcome),
      code: r.code, url, originalSha256: r.sha256, qrPng: await qrPng(url), note: upload ? UPLOAD_HASH_NOTE : undefined,
    };
  }

  const self: DocumentsService = {
    async create(userId, category, key) {
      const { template: t } = await template(category);
      const { rows } = await pool.query("select create_document($1, $2, $3, $4, $5, $6) as id", [userId, category, t.id, t.version, t.title, key]);
      return { documentId: rows[0].id };
    },

    async saveDraft(userId, documentId, data, revision) {
      const doc = await ownedTemplate(userId, documentId);
      if (!doc) throw new NotFoundError();
      // Hanya field skema dengan nilai string/angka yang disimpan; sisanya dibuang.
      const known = new Set(TEMPLATES[doc.category].fields.map((f) => f.key));
      const clean: Data = {};
      for (const [k, v] of Object.entries(data)) if (known.has(k) && (typeof v === "string" || typeof v === "number")) clean[k] = v;
      try {
        const { rows } = await pool.query("select save_draft($1, $2, $3, $4) as rev", [userId, documentId, JSON.stringify(clean), revision]);
        return { revision: rows[0].rev };
      } catch (e) {
        if (e instanceof Error && e.message.includes("STALE_REVISION")) throw new StaleRevisionError();
        if (isNotFound(e)) throw new NotFoundError();
        throw e;
      }
    },

    async freeze(userId, documentId, key, now = new Date()) {
      const doc = await ownedTemplate(userId, documentId);
      if (!doc) throw new NotFoundError();
      let resolved;
      try {
        resolved = await template(doc.category);
      } catch (e) {
        if (e instanceof TemplateNotApprovedError) return { ok: false, code: "TEMPLATE_NOT_APPROVED" };
        throw e;
      }
      const checked = resolved.template.validate(doc.structured_data);
      if (!checked.ok) return { ok: false, code: "VALIDATION_FAILED", errors: checked.errors };

      const canonical = canonicalize(renderDocument(resolved.template, checked.data, resolved.approval));
      try {
        const { rows } = await pool.query("select * from freeze_version($1, $2, $3, $4, $5, $6)", [userId, documentId, canonical, JSON.stringify(checked.data), key, now]);
        const r = rows[0];
        if (r.status === "QUOTA_DOCUMENT") return { ok: false, code: "DOCUMENT_DAILY_QUOTA_REACHED", resetAt: (r.reset_at as Date).toISOString() };
        return { ok: true, versionId: r.version_id, versionNo: r.version_no, sha256: r.sha256, duplicate: r.status === "DUPLICATE" };
      } catch (e) {
        if (isNotFound(e)) throw new NotFoundError();
        throw e;
      }
    },

    async list(userId) {
      const { rows } = await pool.query(
        `select d.id, d.category, d.title, d.created_at, count(v.id)::int as vc, max(v.version_no) as lv
           from documents d left join document_versions v on v.document_id = d.id
          where d.owner_id = $1 group by d.id order by d.created_at desc`,
        [userId],
      );
      return rows.map((r) => ({ id: r.id, category: r.category, title: r.title, createdAt: r.created_at.toISOString(), versionCount: r.vc, latestVersionNo: r.lv }));
    },

    async get(userId, documentId) {
      const doc = await owned(userId, documentId);
      if (!doc) return null;
      const { rows } = await pool.query("select id, version_no, sha256, created_at from document_versions where document_id = $1 order by version_no", [documentId]);
      return { id: doc.id, category: doc.category, title: doc.title, draft: { data: doc.structured_data, revision: doc.revision }, versions: rows.map(toVersion) };
    },

    async getVersion(userId, versionId) {
      const { rows } = await pool.query(
        `select v.id, v.document_id, v.version_no, v.sha256, v.created_at, v.canonical_text, v.structured_data
           from document_versions v join documents d on d.id = v.document_id
          where v.id = $1 and d.owner_id = $2`,
        [versionId, userId],
      );
      const r = rows[0];
      if (!r) return null;
      return { ...toVersion(r), documentId: r.document_id, canonicalText: r.canonical_text, doc: parseCanonical(r.canonical_text), structuredData: r.structured_data };
    },

    async clone(userId, versionId, key) {
      try {
        const { rows } = await pool.query("select clone_document($1, $2, $3) as id", [userId, versionId, key]);
        return { documentId: rows[0].id };
      } catch (e) {
        // Dokumen unggahan tidak dapat disalin menjadi draf template.
        if (isNotFound(e) || (e instanceof Error && e.message.includes("UPLOAD_IMMUTABLE"))) return null;
        throw e;
      }
    },

    async exportVersion(userId, versionId, format) {
      const v = await self.getVersion(userId, versionId);
      if (!v) return null;
      const blob = needBlob();
      const verification = await activeVerification(versionId, v.doc.category === "UPLOAD");
      const bytes = format === "DOCX" ? await exportDocx(v.doc, verification) : await exportPdf(v.doc, verification);
      const sha256 = sha256Hex(bytes);
      const path = `${userId}/${v.documentId}/${versionId}-${randomUUID()}.${FORMATS[format].ext}`;
      // Blob ditulis dulu; bila pencatatan gagal, yang tersisa hanya berkas yatim (tidak ada baris yang menunjuk ke berkas hilang).
      await blob.put(path, bytes);
      const { rows } = await pool.query("select register_export($1, $2, $3, $4, $5, $6) as id", [userId, versionId, format, sha256, bytes.byteLength, path]);
      return { exportId: rows[0].id, sha256, byteSize: bytes.byteLength };
    },

    async downloadExport(userId, exportId) {
      const { rows } = await pool.query(
        `select e.format, e.sha256, e.storage_path, d.title, v.version_no
           from document_exports e
           join document_versions v on v.id = e.version_id
           join documents d on d.id = v.document_id
          where e.id = $1 and d.owner_id = $2`,
        [exportId, userId],
      );
      const r = rows[0];
      if (!r) return null;
      const bytes = await needBlob().get(r.storage_path);
      if (!bytes) throw new IntegrityError("BLOB_MISSING");
      if (sha256Hex(bytes) !== r.sha256) throw new IntegrityError("HASH_MISMATCH");
      const f = FORMATS[r.format as ExportFormat];
      return { bytes, filename: `${slug(r.title)}-v${r.version_no}.${f.ext}`, contentType: f.contentType };
    },
  };
  return self;
}

import type { Pool } from "pg";
import { canonicalize, parseCanonical, renderDocument, type RenderedDoc } from "./render";
import { getTemplate, TemplateNotApprovedError, TEMPLATES, type ApprovalCheck } from "./templates/registry";
import type { Category, Data } from "./types";

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

export type FreezeResult =
  | { ok: true; versionId: string; versionNo: number; sha256: string; duplicate: boolean }
  | { ok: false; code: "VALIDATION_FAILED"; errors: Record<string, string> }
  | { ok: false; code: "DOCUMENT_DAILY_QUOTA_REACHED"; resetAt: string }
  | { ok: false; code: "TEMPLATE_NOT_APPROVED" };

export type VersionSummary = { id: string; versionNo: number; sha256: string; createdAt: string };
export type DocSummary = { id: string; category: Category; title: string; createdAt: string; versionCount: number; latestVersionNo: number | null };
export type DocDetail = { id: string; category: Category; title: string; draft: { data: Data; revision: number }; versions: VersionSummary[] };
export type VersionDetail = VersionSummary & { documentId: string; canonicalText: string; doc: RenderedDoc; structuredData: Data };

export interface DocumentsService {
  create(userId: string, category: Category, key: string): Promise<{ documentId: string }>;
  saveDraft(userId: string, documentId: string, data: Data, revision: number): Promise<{ revision: number }>;
  freeze(userId: string, documentId: string, key: string, now?: Date): Promise<FreezeResult>;
  list(userId: string): Promise<DocSummary[]>;
  get(userId: string, documentId: string): Promise<DocDetail | null>;
  getVersion(userId: string, versionId: string): Promise<VersionDetail | null>;
}

type Env = { ALLOW_UNAPPROVED_TEMPLATES?: string; NODE_ENV?: string };
type Deps = { isApproved?: ApprovalCheck };

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
    return rows[0] as { id: string; category: Category; title: string; structured_data: Data; revision: number } | undefined;
  }

  const toVersion = (r: { id: string; version_no: number; sha256: string; created_at: Date }): VersionSummary => ({
    id: r.id, versionNo: r.version_no, sha256: r.sha256, createdAt: r.created_at.toISOString(),
  });

  return {
    async create(userId, category, key) {
      const { template: t } = await template(category);
      const { rows } = await pool.query("select create_document($1, $2, $3, $4, $5, $6) as id", [userId, category, t.id, t.version, t.title, key]);
      return { documentId: rows[0].id };
    },

    async saveDraft(userId, documentId, data, revision) {
      const doc = await owned(userId, documentId);
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
      const doc = await owned(userId, documentId);
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
  };
}

import type { Pool } from "pg";

// Kasus Hukum Khusus. Semua wewenang dan transisi status diputuskan di fungsi database (supabase/migrations/20261016000030_special_cases.sql).
export type CaseStatus = "SUBMITTED" | "TRIAGED" | "QUOTED" | "ACCEPTED" | "DECLINED" | "CLOSED";
export const CASE_ERROR_CODES = [
  "NOT_FOUND", "FORBIDDEN", "CONSENT_REQUIRED", "SUMMARY_INVALID", "CASE_EXISTS", "INVALID_STATE", "CONFLICT_CHECK_REQUIRED",
  "INVALID_AMOUNT", "INVALID_SCOPE", "INVALID_EXPIRY", "QUOTE_EXPIRED", "STALE_QUOTE", "INVALID_FIRM",
] as const;
export type CaseErrorCode = (typeof CASE_ERROR_CODES)[number];

export class CaseError extends Error {
  constructor(readonly code: CaseErrorCode) {
    super(code);
    this.name = "CaseError";
  }
}

function mapError(e: unknown): never {
  const m = e instanceof Error ? e.message : "";
  for (const c of CASE_ERROR_CODES) if (m.includes(c)) throw new CaseError(c);
  if (/invalid input syntax for type uuid/.test(m)) throw new CaseError("NOT_FOUND");
  throw e;
}
const call = async <T>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (e) {
    return mapError(e);
  }
};

export type CaseQuote = { amountIdr: number; scope: string; expiresAt: string; revision: number; quotedAt: string | null };
export type OwnerCase = {
  id: string; documentId: string | null; documentTitle: string | null; status: CaseStatus; summary: string; consentAt: string; createdAt: string;
  triagedAt: string | null; decidedAt: string | null; closedAt: string | null; closeReason: string | null; quote: CaseQuote | null;
};
export type CaseRow = { id: string; documentId: string | null; documentTitle: string | null; status: CaseStatus; createdAt: string; quoteExpiresAt: string | null };
export type PartnerCaseRow = { id: string; status: CaseStatus; createdAt: string; category: string | null; firmName: string; quoteExpiresAt: string | null };
export type PartnerCase = PartnerCaseRow & { summary: string; consentAt: string; triagedAt: string | null; decidedAt: string | null; closedAt: string | null; closeReason: string | null; quote: CaseQuote | null };
export type AdminCaseRow = { id: string; status: CaseStatus; createdAt: string; firmId: string | null; firmName: string | null; quoteAmountIdr: number | null; quoteExpiresAt: string | null };

export interface CasesService {
  submit(ownerId: string, input: { documentId: string | null; summary: string; consent: boolean; key: string }, now?: Date): Promise<string>;
  getForOwner(ownerId: string, caseId: string): Promise<OwnerCase | null>;
  listForOwner(ownerId: string): Promise<CaseRow[]>;
  openForDocument(ownerId: string, documentId: string): Promise<string | null>;
  accept(ownerId: string, caseId: string, revision: number, now?: Date): Promise<void>;
  decline(ownerId: string, caseId: string, now?: Date): Promise<void>;
  partnerList(actorId: string): Promise<PartnerCaseRow[]>;
  partnerGet(actorId: string, caseId: string): Promise<PartnerCase | null>;
  triage(actorId: string, caseId: string, conflictCleared: boolean, now?: Date): Promise<void>;
  quote(actorId: string, caseId: string, q: { amountIdr: number; scope: string; expiresAt: Date }, now?: Date): Promise<number>;
  // Pemilik (menarik permintaan) atau koordinator firma kasus.
  close(actorId: string, caseId: string, reason: string, now?: Date): Promise<void>;
  adminList(adminId: string): Promise<AdminCaseRow[]>;
  route(adminId: string, caseId: string, firmId: string, now?: Date): Promise<void>;
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
type Row = Record<string, unknown>;
const quoteOf = (r: Row): CaseQuote | null =>
  r.quote_amount_idr == null
    ? null
    : { amountIdr: Number(r.quote_amount_idr), scope: String(r.quote_scope), expiresAt: (r.quote_expires_at as Date).toISOString(), revision: Number(r.quote_revision), quotedAt: iso(r.quoted_at as Date | null) };

export function createPgCasesService(pool: Pool): CasesService {
  return {
    submit: (ownerId, i, now = new Date()) =>
      call(async () => (await pool.query("select submit_special_case($1, $2, $3, $4, $5, $6) as id", [ownerId, i.documentId, i.summary, i.consent, i.key, now])).rows[0].id),

    getForOwner: (ownerId, caseId) =>
      call(async () => {
        const r = (await pool.query("select * from special_case_for_owner($1, $2)", [ownerId, caseId])).rows[0] as Row | undefined;
        if (!r) return null;
        return {
          id: r.id as string, documentId: (r.document_id as string) ?? null, documentTitle: (r.document_title as string) ?? null, status: r.status as CaseStatus,
          summary: r.summary as string, consentAt: (r.consent_at as Date).toISOString(), createdAt: (r.created_at as Date).toISOString(),
          triagedAt: iso(r.triaged_at as Date), decidedAt: iso(r.decided_at as Date), closedAt: iso(r.closed_at as Date), closeReason: (r.close_reason as string) ?? null, quote: quoteOf(r),
        };
      }),

    listForOwner: (ownerId) =>
      call(async () =>
        (await pool.query("select * from owner_special_cases($1)", [ownerId])).rows.map((r) => ({
          id: r.id, documentId: r.document_id, documentTitle: r.document_title, status: r.status, createdAt: r.created_at.toISOString(), quoteExpiresAt: iso(r.quote_expires_at),
        }))),

    openForDocument: (ownerId, documentId) =>
      call(async () => ((await pool.query("select special_case_open_for_document($1, $2) as id", [ownerId, documentId])).rows[0].id as string | null) ?? null),

    accept: (ownerId, caseId, revision, now = new Date()) => call(async () => void (await pool.query("select accept_special_case_quote($1, $2, $3, $4)", [ownerId, caseId, revision, now]))),
    decline: (ownerId, caseId, now = new Date()) => call(async () => void (await pool.query("select decline_special_case_quote($1, $2, $3)", [ownerId, caseId, now]))),

    partnerList: (actorId) =>
      call(async () =>
        (await pool.query("select * from partner_special_cases($1)", [actorId])).rows.map((r) => ({
          id: r.id, status: r.status, createdAt: r.created_at.toISOString(), category: r.category, firmName: r.firm_name, quoteExpiresAt: iso(r.quote_expires_at),
        }))),

    partnerGet: (actorId, caseId) =>
      call(async () => {
        const r = (await pool.query("select * from special_case_for_partner($1, $2)", [actorId, caseId])).rows[0] as Row | undefined;
        if (!r) return null;
        return {
          id: r.id as string, status: r.status as CaseStatus, createdAt: (r.created_at as Date).toISOString(), category: (r.category as string) ?? null, firmName: r.firm_name as string,
          quoteExpiresAt: iso(r.quote_expires_at as Date), summary: r.summary as string, consentAt: (r.consent_at as Date).toISOString(), triagedAt: iso(r.triaged_at as Date),
          decidedAt: iso(r.decided_at as Date), closedAt: iso(r.closed_at as Date), closeReason: (r.close_reason as string) ?? null, quote: quoteOf(r),
        };
      }),

    triage: (actorId, caseId, cleared, now = new Date()) => call(async () => void (await pool.query("select triage_special_case($1, $2, $3, $4)", [actorId, caseId, cleared, now]))),
    quote: (actorId, caseId, q, now = new Date()) =>
      call(async () => (await pool.query("select quote_special_case($1, $2, $3, $4, $5, $6) as rev", [actorId, caseId, q.amountIdr, q.scope, q.expiresAt, now])).rows[0].rev as number),
    close: (actorId, caseId, reason, now = new Date()) => call(async () => void (await pool.query("select close_special_case($1, $2, $3, $4)", [actorId, caseId, reason, now]))),

    adminList: (adminId) =>
      call(async () =>
        (await pool.query("select * from admin_special_cases($1)", [adminId])).rows.map((r) => ({
          id: r.id, status: r.status, createdAt: r.created_at.toISOString(), firmId: r.firm_id, firmName: r.firm_name,
          quoteAmountIdr: r.quote_amount_idr == null ? null : Number(r.quote_amount_idr), quoteExpiresAt: iso(r.quote_expires_at),
        }))),
    route: (adminId, caseId, firmId, now = new Date()) => call(async () => void (await pool.query("select admin_route_special_case($1, $2, $3, $4)", [adminId, caseId, firmId, now]))),
  };
}

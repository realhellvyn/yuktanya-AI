import type { Pool } from "pg";
import { parseCanonical, type RenderedDoc } from "@/lib/documents/render";

export type ReviewErrorCode =
  | "FORBIDDEN" | "NOT_FOUND" | "REVIEWER_NOT_AUTHORIZED" | "REVIEWER_AT_CAPACITY" | "STALE_REVISION" | "VERSION_MISMATCH"
  | "ATTESTATION_REQUIRED" | "VALIDATION_FAILED" | "NOT_ASSIGNABLE" | "CONFLICT_ATTESTATION_REQUIRED" | "CONFLICT_OF_INTEREST" | "ENHANCED_DISABLED";
export class ReviewError extends Error {
  constructor(readonly code: ReviewErrorCode, readonly reason?: string) {
    super(reason ? `${code}: ${reason}` : code);
    this.name = "ReviewError";
  }
}
// CONFLICT_ATTESTATION_REQUIRED memuat ATTESTATION_REQUIRED sebagai bagian teks: harus dicek lebih dulu.
export const REVIEW_CODES: ReviewErrorCode[] = [
  "CONFLICT_ATTESTATION_REQUIRED", "CONFLICT_OF_INTEREST", "ENHANCED_DISABLED",
  "REVIEWER_NOT_AUTHORIZED", "REVIEWER_AT_CAPACITY", "STALE_REVISION", "VERSION_MISMATCH", "ATTESTATION_REQUIRED", "NOT_ASSIGNABLE", "FORBIDDEN", "NOT_FOUND",
];
function mapError(e: unknown): never {
  const m = e instanceof Error ? e.message : "";
  const v = /VALIDATION_FAILED: ([A-Z_]+)/.exec(m);
  if (v) throw new ReviewError("VALIDATION_FAILED", v[1]);
  for (const c of REVIEW_CODES) if (m.includes(c)) throw new ReviewError(c);
  throw e;
}

export type Outcome = "WITH_NOTES" | "WITHIN_SCOPE" | "INCONCLUSIVE" | "DECLINED";
export type NoteInput = {
  noteNo?: number; blockId?: string | null; quote?: string | null; title: string; finding: string;
  severity: "INFO" | "MINOR" | "MATERIAL" | "CRITICAL"; actionable: boolean;
  recommendedAction?: string | null; rationale?: string | null; escalation?: string | null;
};
export type NoteView = NoteInput & { noteNo: number; status: "DRAFT" | "PUBLISHED" };
// mine: catatan disimpan reviewer ini dalam penugasan aktifnya. false = buatan penugasan sebelumnya, wajib dikonfirmasi ulang.
export type EditorNote = NoteView & { mine: boolean };
export type OwnerReview = {
  requestId: string; versionId: string; status: string; outcome: string | null; createdAt: string; completedAt: string | null;
  title: string; versionNo: number; scope: string | null; assumptions: string | null; summary: string | null;
  notes: NoteView[]; verification: { id: string; code: string; status: string } | null;
};
export type OwnerReviewRow = { requestId: string; title: string; versionNo: number; status: string; outcome: string | null; createdAt: string };
export type QueueRow = { requestId: string; status: string; createdAt: string; assignedAt: string; category: string };
export type OpenedReview = {
  requestId: string; title: string; category: string; doc: RenderedDoc; revision: number; versionNo: number; sha256: string; authorized: boolean;
  scope: string; assumptions: string; summary: string; notes: EditorNote[];
  // false = lingkup/asumsi/ringkasan terakhir disimpan dalam penugasan lain (atau belum pernah disimpan).
  draftMine: boolean;
};
export type InflightRow = { requestId: string; status: string; createdAt: string; category: string; reviewerId: string; reviewerAuthorized: boolean };
export type PublishInput = { revision: number; outcome: Outcome; noNotesDeclared: boolean; attest: boolean; noConflict: boolean };

export interface ReviewService {
  listForOwner(userId: string): Promise<OwnerReviewRow[]>;
  getForOwner(userId: string, requestId: string): Promise<OwnerReview | null>;
  queue(reviewerId: string): Promise<QueueRow[]>;
  open(reviewerId: string, requestId: string, now?: Date): Promise<OpenedReview>;
  saveDraft(reviewerId: string, requestId: string, revision: number, d: { scope: string; assumptions: string; summary: string }, now?: Date): Promise<number>;
  upsertNote(reviewerId: string, requestId: string, revision: number, note: NoteInput, now?: Date): Promise<{ revision: number; noteNo: number }>;
  deleteNote(reviewerId: string, requestId: string, revision: number, noteNo: number, now?: Date): Promise<number>;
  publish(reviewerId: string, requestId: string, input: PublishInput, now?: Date): Promise<{ status: string; verificationId: string | null; code: string | null }>;
  // conflict: firma koordinator sudah mencatat konflik kepentingan dengan pemilik dokumen ini.
  unassigned(actorId: string): Promise<{ requestId: string; createdAt: string; category: string; conflict: boolean }[]>;
  declareConflict(actorId: string, requestId: string, now?: Date): Promise<void>;
  reviewers(actorId: string): Promise<{ reviewerId: string; email: string; firmId: string; active: number }[]>;
  assign(actorId: string, requestId: string, reviewerId: string, now?: Date): Promise<void>;
  reassign(actorId: string, requestId: string, reviewerId: string, now?: Date): Promise<void>;
  inflight(actorId: string, now?: Date): Promise<InflightRow[]>;
}

const noteRow = (n: Record<string, unknown>): NoteView => ({
  noteNo: n.note_no as number, blockId: (n.block_id as string | null) ?? null, quote: (n.quote as string | null) ?? null, title: n.title as string,
  finding: n.finding as string, severity: n.severity as NoteView["severity"], actionable: n.actionable as boolean,
  recommendedAction: (n.recommended_action as string | null) ?? null, rationale: (n.rationale as string | null) ?? null,
  escalation: (n.escalation as string | null) ?? null, status: ((n.status as string | undefined) ?? "PUBLISHED") as NoteView["status"],
});

export function createPgReviewService(pool: Pool): ReviewService {
  return {
    async listForOwner(userId) {
      const { rows } = await pool.query(
        `select r.id, d.title, v.version_no, r.status, r.outcome, r.created_at
           from review_requests r join document_versions v on v.id = r.version_id join documents d on d.id = v.document_id
          where r.owner_id = $1 order by r.created_at desc limit 50`, [userId]);
      return rows.map((r) => ({ requestId: r.id, title: r.title, versionNo: r.version_no, status: r.status, outcome: r.outcome, createdAt: r.created_at.toISOString() }));
    },

    async getForOwner(userId, requestId) {
      const { rows } = await pool.query("select * from get_review_for_owner($1, $2)", [userId, requestId]);
      const r = rows[0];
      if (!r) return null;
      const meta = (await pool.query("select d.title, v.version_no from document_versions v join documents d on d.id = v.document_id where v.id = $1", [r.version_id])).rows[0];
      return {
        requestId: r.request_id, versionId: r.version_id, status: r.status, outcome: r.outcome, createdAt: r.created_at.toISOString(),
        completedAt: r.completed_at ? r.completed_at.toISOString() : null, title: meta.title, versionNo: meta.version_no,
        scope: r.scope, assumptions: r.assumptions, summary: r.summary, notes: (r.notes as Record<string, unknown>[]).map(noteRow),
        verification: r.verification_id ? { id: r.verification_id, code: r.verification_code, status: r.verification_status } : null,
      };
    },

    async queue(reviewerId) {
      const { rows } = await pool.query("select * from reviewer_queue($1)", [reviewerId]);
      return rows.map((r) => ({ requestId: r.request_id, status: r.status, createdAt: r.created_at.toISOString(), assignedAt: r.assigned_at.toISOString(), category: r.category }));
    },

    async open(reviewerId, requestId, now = new Date()) {
      try {
        const { rows } = await pool.query("select * from start_review($1, $2, $3)", [reviewerId, requestId, now]);
        const s = rows[0];
        const asg = (await pool.query("select id from review_assignments where request_id = $1 and reviewer_id = $2 and status = 'ACTIVE'", [requestId, reviewerId])).rows[0]?.id ?? null;
        const rep = (await pool.query("select scope, assumptions, summary, revision, drafted_assignment_id from review_reports where request_id = $1", [requestId])).rows[0];
        const notes = (await pool.query("select * from legal_notes where report_id = (select id from review_reports where request_id = $1) order by note_no", [requestId])).rows;
        const meta = (await pool.query(
          `select v.version_no, r.version_sha256, r.firm_id is not null and reviewer_has_authority($2, r.firm_id, $3) as authorized
             from review_requests r join document_versions v on v.id = r.version_id where r.id = $1`, [requestId, reviewerId, now])).rows[0];
        return {
          requestId, title: s.title, category: s.category, doc: parseCanonical(s.version_text), revision: rep.revision,
          versionNo: meta.version_no, sha256: meta.version_sha256, authorized: meta.authorized,
          scope: rep.scope, assumptions: rep.assumptions, summary: rep.summary,
          notes: notes.map((n) => ({ ...noteRow(n), mine: asg !== null && n.assignment_id === asg })),
          draftMine: asg !== null && rep.drafted_assignment_id === asg,
        };
      } catch (e) {
        return mapError(e);
      }
    },

    async saveDraft(reviewerId, requestId, revision, d, now = new Date()) {
      try {
        const { rows } = await pool.query("select save_report_draft($1, $2, $3, $4, $5, $6, $7) as r", [reviewerId, requestId, revision, d.scope, d.assumptions, d.summary, now]);
        return rows[0].r;
      } catch (e) {
        return mapError(e);
      }
    },

    async upsertNote(reviewerId, requestId, revision, note, now = new Date()) {
      const payload = {
        note_no: note.noteNo, block_id: note.blockId, quote: note.quote, title: note.title, finding: note.finding, severity: note.severity,
        actionable: note.actionable, recommended_action: note.recommendedAction, rationale: note.rationale, escalation: note.escalation,
      };
      try {
        const { rows } = await pool.query("select * from upsert_note($1, $2, $3, $4, $5)", [reviewerId, requestId, revision, JSON.stringify(payload), now]);
        return { revision: rows[0].revision, noteNo: rows[0].note_no };
      } catch (e) {
        return mapError(e);
      }
    },

    async deleteNote(reviewerId, requestId, revision, noteNo, now = new Date()) {
      try {
        return (await pool.query("select delete_note($1, $2, $3, $4, $5) as r", [reviewerId, requestId, revision, noteNo, now])).rows[0].r;
      } catch (e) {
        return mapError(e);
      }
    },

    async publish(reviewerId, requestId, input, now = new Date()) {
      try {
        const { rows } = await pool.query("select * from publish_standard($1, $2, $3, $4, $5, $6, $7, $8)",
          [reviewerId, requestId, input.revision, input.outcome, input.noNotesDeclared, input.attest, input.noConflict, now]);
        return { status: rows[0].status, verificationId: rows[0].verification_id ?? null, code: rows[0].code ?? null };
      } catch (e) {
        return mapError(e);
      }
    },

    async unassigned(actorId) {
      const { rows } = await pool.query("select * from coordinator_unassigned($1)", [actorId]);
      const ids = rows.map((r) => r.request_id as string);
      const conflicted = ids.length === 0 ? new Set<string>() : new Set((await pool.query(
        // Konflik firma: firma permintaan ini berkonflik dengan pemiliknya, atau permintaan sudah dilepas ke perutean admin
        // (firma kosong) dan pemiliknya punya konflik dengan suatu firma.
        `select r.id from review_requests r where r.id = any($1) and exists (select 1 from firm_conflicts c where c.owner_id = r.owner_id
            and (r.firm_id is null or c.firm_id = r.firm_id))`, [ids],
      )).rows.map((r) => r.id as string));
      return rows.map((r) => ({ requestId: r.request_id, createdAt: r.created_at.toISOString(), category: r.category, conflict: conflicted.has(r.request_id) }));
    },

    async declareConflict(actorId, requestId, now = new Date()) {
      try {
        await pool.query("select declare_firm_conflict($1, 'STANDARD', $2, $3)", [actorId, requestId, now]);
      } catch (e) {
        mapError(e);
      }
    },

    async reviewers(actorId) {
      const { rows } = await pool.query(
        `select m.user_id, m.firm_id, u.email::text as email, (select count(*) from review_assignments a where a.reviewer_id = m.user_id and a.status = 'ACTIVE') as active
           from firm_members m join auth.users u on u.id = m.user_id
          where m.role = 'reviewer' and (is_platform_admin($1) or exists (select 1 from firm_members c where c.firm_id = m.firm_id and c.user_id = $1 and c.role = 'coordinator'))
          order by m.firm_id, m.user_id`, [actorId]);
      return rows.map((r) => ({ reviewerId: r.user_id, email: r.email ?? r.user_id.slice(0, 8), firmId: r.firm_id, active: Number(r.active) }));
    },

    async assign(actorId, requestId, reviewerId, now = new Date()) {
      try {
        await pool.query("select assign_review($1, $2, $3, $4)", [actorId, requestId, reviewerId, now]);
      } catch (e) {
        mapError(e);
      }
    },

    async reassign(actorId, requestId, reviewerId, now = new Date()) {
      try {
        await pool.query("select reassign_review($1, $2, $3, $4)", [actorId, requestId, reviewerId, now]);
      } catch (e) {
        mapError(e);
      }
    },

    async inflight(actorId, now = new Date()) {
      const { rows } = await pool.query("select * from coordinator_inflight($1, $2)", [actorId, now]);
      return rows.map((r) => ({ requestId: r.request_id, status: r.status, createdAt: r.created_at.toISOString(), category: r.category, reviewerId: r.reviewer_id, reviewerAuthorized: r.reviewer_authorized }));
    },
  };
}

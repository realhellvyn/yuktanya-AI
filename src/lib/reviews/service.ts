import type { Pool } from "pg";
import { parseCanonical, type RenderedDoc } from "@/lib/documents/render";

export type ReviewErrorCode =
  | "FORBIDDEN" | "NOT_FOUND" | "REVIEWER_NOT_AUTHORIZED" | "REVIEWER_AT_CAPACITY" | "STALE_REVISION" | "VERSION_MISMATCH"
  | "ATTESTATION_REQUIRED" | "VALIDATION_FAILED" | "NOT_ASSIGNABLE";
export class ReviewError extends Error {
  constructor(readonly code: ReviewErrorCode, readonly reason?: string) {
    super(reason ? `${code}: ${reason}` : code);
    this.name = "ReviewError";
  }
}
const CODES: ReviewErrorCode[] = [
  "REVIEWER_NOT_AUTHORIZED", "REVIEWER_AT_CAPACITY", "STALE_REVISION", "VERSION_MISMATCH", "ATTESTATION_REQUIRED", "NOT_ASSIGNABLE", "FORBIDDEN", "NOT_FOUND",
];
function mapError(e: unknown): never {
  const m = e instanceof Error ? e.message : "";
  const v = /VALIDATION_FAILED: ([A-Z_]+)/.exec(m);
  if (v) throw new ReviewError("VALIDATION_FAILED", v[1]);
  for (const c of CODES) if (m.includes(c)) throw new ReviewError(c);
  throw e;
}

export type Outcome = "WITH_NOTES" | "WITHIN_SCOPE" | "INCONCLUSIVE" | "DECLINED";
export type NoteInput = {
  noteNo?: number; blockId?: string | null; quote?: string | null; title: string; finding: string;
  severity: "INFO" | "MINOR" | "MATERIAL" | "CRITICAL"; actionable: boolean;
  recommendedAction?: string | null; rationale?: string | null; escalation?: string | null;
};
export type NoteView = NoteInput & { noteNo: number; status: "DRAFT" | "PUBLISHED" };
export type OwnerReview = {
  requestId: string; versionId: string; status: string; outcome: string | null; createdAt: string; completedAt: string | null;
  title: string; versionNo: number; scope: string | null; assumptions: string | null; summary: string | null;
  notes: NoteView[]; verification: { id: string; code: string; status: string } | null;
};
export type OwnerReviewRow = { requestId: string; title: string; versionNo: number; status: string; outcome: string | null; createdAt: string };
export type QueueRow = { requestId: string; status: string; createdAt: string; assignedAt: string; category: string };
export type OpenedReview = {
  requestId: string; title: string; category: string; doc: RenderedDoc; revision: number;
  scope: string; assumptions: string; summary: string; notes: NoteView[];
};
export type PublishInput = { revision: number; outcome: Outcome; noNotesDeclared: boolean; attest: boolean };

export interface ReviewService {
  listForOwner(userId: string): Promise<OwnerReviewRow[]>;
  getForOwner(userId: string, requestId: string): Promise<OwnerReview | null>;
  queue(reviewerId: string): Promise<QueueRow[]>;
  open(reviewerId: string, requestId: string, now?: Date): Promise<OpenedReview>;
  saveDraft(reviewerId: string, requestId: string, revision: number, d: { scope: string; assumptions: string; summary: string }, now?: Date): Promise<number>;
  upsertNote(reviewerId: string, requestId: string, revision: number, note: NoteInput, now?: Date): Promise<{ revision: number; noteNo: number }>;
  deleteNote(reviewerId: string, requestId: string, revision: number, noteNo: number, now?: Date): Promise<number>;
  publish(reviewerId: string, requestId: string, input: PublishInput, now?: Date): Promise<{ status: string; verificationId: string | null; code: string | null }>;
  unassigned(actorId: string): Promise<{ requestId: string; createdAt: string; category: string }[]>;
  reviewers(actorId: string): Promise<{ reviewerId: string; firmId: string; active: number }[]>;
  assign(actorId: string, requestId: string, reviewerId: string, now?: Date): Promise<void>;
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
        const rep = (await pool.query("select scope, assumptions, summary, revision from review_reports where request_id = $1", [requestId])).rows[0];
        const notes = (await pool.query("select * from legal_notes where report_id = (select id from review_reports where request_id = $1) order by note_no", [requestId])).rows;
        return {
          requestId, title: s.title, category: s.category, doc: parseCanonical(s.version_text), revision: rep.revision,
          scope: rep.scope, assumptions: rep.assumptions, summary: rep.summary, notes: notes.map(noteRow),
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
        const { rows } = await pool.query("select * from publish_standard($1, $2, $3, $4, $5, $6, $7)", [reviewerId, requestId, input.revision, input.outcome, input.noNotesDeclared, input.attest, now]);
        return { status: rows[0].status, verificationId: rows[0].verification_id ?? null, code: rows[0].code ?? null };
      } catch (e) {
        return mapError(e);
      }
    },

    async unassigned(actorId) {
      const { rows } = await pool.query("select * from coordinator_unassigned($1)", [actorId]);
      return rows.map((r) => ({ requestId: r.request_id, createdAt: r.created_at.toISOString(), category: r.category }));
    },

    async reviewers(actorId) {
      const { rows } = await pool.query(
        `select m.user_id, m.firm_id, (select count(*) from review_assignments a where a.reviewer_id = m.user_id and a.status = 'ACTIVE') as active
           from firm_members m
          where m.role = 'reviewer' and (is_platform_admin($1) or exists (select 1 from firm_members c where c.firm_id = m.firm_id and c.user_id = $1 and c.role = 'coordinator'))
          order by m.firm_id, m.user_id`, [actorId]);
      return rows.map((r) => ({ reviewerId: r.user_id, firmId: r.firm_id, active: Number(r.active) }));
    },

    async assign(actorId, requestId, reviewerId, now = new Date()) {
      try {
        await pool.query("select assign_review($1, $2, $3, $4)", [actorId, requestId, reviewerId, now]);
      } catch (e) {
        mapError(e);
      }
    },
  };
}

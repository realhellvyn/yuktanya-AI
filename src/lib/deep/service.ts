import type { Pool } from "pg";
import { parseCanonical, type RenderedDoc } from "@/lib/documents/render";
import { ReviewError } from "@/lib/reviews/service";
import { RUBRIC_VERSION } from "./rubric";

type Code = ConstructorParameters<typeof ReviewError>[0];
const CODES: Code[] = ["REVIEWER_NOT_AUTHORIZED", "REVIEWER_AT_CAPACITY", "STALE_REVISION", "VERSION_MISMATCH", "ATTESTATION_REQUIRED", "NOT_ASSIGNABLE", "FORBIDDEN", "NOT_FOUND"];
function mapError(e: unknown): never {
  const m = e instanceof Error ? e.message : "";
  const g = /GUARD_FAILED: ([A-Z_]+)/.exec(m);
  if (g) throw new ReviewError("VALIDATION_FAILED", g[1]);
  for (const r of ["REASON_REQUIRED", "INVALID_DECISION", "MANDATORY_ITEM"]) if (m.includes(r)) throw new ReviewError("VALIDATION_FAILED", r);
  for (const c of CODES) if (m.includes(c)) throw new ReviewError(c);
  throw e;
}

// standardPaidIdr: harga Review Standar induk yang sudah dibayar (0 bila memakai kredit); null bila tidak layak.
export type Eligibility = { eligible: boolean; reason: string; quote: { amountIdr: number; variant: string } | null; standardPaidIdr: number | null };
export type ParentNote = { noteNo: number; title: string; finding: string; severity: string; actionable: boolean; recommendedAction: string | null };
export type ChecklistRow = { item: string; result: string; reasoning: string; evidenceRef: string };
export type DispositionRow = { noteNo: number; disposition: string; evidence: string };
export type OpenedDeep = {
  deepId: string; title: string; category: string; doc: RenderedDoc; revision: number; parentNotes: ParentNote[];
  versionNo: number; sha256: string; parentScope: string; rubricApproved: boolean; authorized: boolean;
  extraWork: string; summary: string; dispositions: DispositionRow[]; checklist: ChecklistRow[];
};
export type OwnerDeep = {
  deepId: string; parentRequestId: string; versionId: string; status: string; outcome: string | null; createdAt: string; completedAt: string | null;
  extraWork: string | null; summary: string | null; decision: string | null; decisionReason: string | null;
  dispositions: DispositionRow[]; verification: { code: string; status: string } | null;
};
export type Decision = "APPROVE" | "DENY" | "INCONCLUSIVE" | "REFER_SPECIAL";

export interface DeepService {
  eligibility(userId: string, parentRequestId: string, now?: Date): Promise<Eligibility>;
  forParent(userId: string, parentRequestId: string): Promise<{ deepId: string } | null>;
  getForOwner(userId: string, deepId: string): Promise<OwnerDeep | null>;
  isAssigned(userId: string, deepId: string): Promise<boolean>;
  queue(reviewerId: string): Promise<{ deepId: string; status: string; createdAt: string; assignedAt: string; category: string }[]>;
  open(reviewerId: string, deepId: string, now?: Date): Promise<OpenedDeep>;
  saveDraft(reviewerId: string, deepId: string, revision: number, d: { extraWork: string; summary: string }, now?: Date): Promise<number>;
  setDisposition(reviewerId: string, deepId: string, revision: number, noteNo: number, disposition: string, evidence: string, now?: Date): Promise<number>;
  setChecklist(reviewerId: string, deepId: string, revision: number, item: string, result: string, reasoning: string, evidence: string, now?: Date): Promise<number>;
  decide(reviewerId: string, deepId: string, revision: number, decision: Decision, reason: string | null, attest: boolean, now?: Date): Promise<{ outcome: string; verificationId: string | null; code: string | null }>;
  unassigned(actorId: string): Promise<{ deepId: string; createdAt: string; category: string }[]>;
  inflight(actorId: string, now?: Date): Promise<{ deepId: string; status: string; createdAt: string; category: string; reviewerId: string; reviewerAuthorized: boolean }[]>;
  assign(actorId: string, deepId: string, reviewerId: string, now?: Date): Promise<void>;
  reassign(actorId: string, deepId: string, reviewerId: string, now?: Date): Promise<void>;
}

export function createPgDeepService(pool: Pool): DeepService {
  return {
    async eligibility(userId, parent, now = new Date()) {
      const { rows } = await pool.query("select * from deep_eligibility($1, $2, $3)", [userId, parent, now]);
      const r = rows[0] as { eligible: boolean; reason: string };
      if (!r.eligible) return { eligible: false, reason: r.reason, quote: null, standardPaidIdr: null };
      const q = (await pool.query("select * from quote_price($1, 'DEEP_REVIEW', $2)", [userId, now])).rows[0];
      const paid = (await pool.query(
        "select o.amount_idr from review_requests r join orders o on o.id = r.order_id where r.id = $1 and r.owner_id = $2 and o.user_id = $2", [parent, userId],
      )).rows[0];
      return { eligible: true, reason: r.reason, quote: { amountIdr: q.amount_idr, variant: q.variant }, standardPaidIdr: paid ? (paid.amount_idr as number) : null };
    },

    async forParent(userId, parent) {
      const { rows } = await pool.query("select id from deep_requests where parent_request_id = $1 and owner_id = $2 and status <> 'CANCELLED'", [parent, userId]);
      return rows[0] ? { deepId: rows[0].id } : null;
    },

    async getForOwner(userId, deepId) {
      const { rows } = await pool.query("select * from get_deep_for_owner($1, $2)", [userId, deepId]);
      const r = rows[0];
      if (!r) return null;
      return {
        deepId: r.deep_id, parentRequestId: r.parent_request_id, versionId: r.version_id, status: r.status, outcome: r.outcome, createdAt: r.created_at.toISOString(),
        completedAt: r.completed_at ? r.completed_at.toISOString() : null, extraWork: r.extra_work, summary: r.summary, decision: r.decision, decisionReason: r.decision_reason,
        dispositions: (r.dispositions as { note_no: number; disposition: string; evidence: string }[]).map((d) => ({ noteNo: d.note_no, disposition: d.disposition, evidence: d.evidence })),
        verification: r.verification_code ? { code: r.verification_code, status: r.verification_status } : null,
      };
    },

    async isAssigned(userId, deepId) {
      const { rows } = await pool.query("select exists (select 1 from deep_assignments a where a.deep_id = d.id) as assigned from deep_requests d where d.id = $1 and d.owner_id = $2", [deepId, userId]);
      return rows[0]?.assigned === true;
    },

    async queue(reviewerId) {
      const { rows } = await pool.query("select * from deep_queue($1)", [reviewerId]);
      return rows.map((r) => ({ deepId: r.deep_id, status: r.status, createdAt: r.created_at.toISOString(), assignedAt: r.assigned_at.toISOString(), category: r.category }));
    },

    async open(reviewerId, deepId, now = new Date()) {
      try {
        const { rows } = await pool.query("select * from start_deep($1, $2, $3)", [reviewerId, deepId, now]);
        const s = rows[0];
        const rep = (await pool.query("select id, extra_work, summary, revision from deep_reports where deep_id = $1", [deepId])).rows[0];
        const disp = (await pool.query("select parent_note_no, disposition, evidence from deep_dispositions where report_id = $1 order by parent_note_no", [rep.id])).rows;
        const chk = (await pool.query("select item, result, reasoning, evidence_ref from deep_checklist where report_id = $1 order by item", [rep.id])).rows;
        const meta = (await pool.query(
          `select v.version_no, d.version_sha256, coalesce(prp.scope, '') as parent_scope,
                  exists (select 1 from rubric_approvals ra where ra.policy_version = $4) as rubric_approved,
                  d.firm_id is not null and reviewer_has_authority($2, d.firm_id, $3) as authorized
             from deep_requests d join document_versions v on v.id = d.version_id
             left join review_reports prp on prp.request_id = d.parent_request_id
            where d.id = $1`, [deepId, reviewerId, now, RUBRIC_VERSION])).rows[0];
        return {
          deepId, title: s.title, category: s.category, doc: parseCanonical(s.version_text), revision: rep.revision,
          versionNo: meta.version_no, sha256: meta.version_sha256, parentScope: meta.parent_scope, rubricApproved: meta.rubric_approved, authorized: meta.authorized,
          parentNotes: (s.parent_notes as Record<string, unknown>[]).map((n) => ({
            noteNo: n.note_no as number, title: n.title as string, finding: n.finding as string, severity: n.severity as string,
            actionable: n.actionable as boolean, recommendedAction: (n.recommended_action as string | null) ?? null,
          })),
          extraWork: rep.extra_work, summary: rep.summary,
          dispositions: disp.map((d) => ({ noteNo: d.parent_note_no, disposition: d.disposition, evidence: d.evidence })),
          checklist: chk.map((c) => ({ item: c.item, result: c.result, reasoning: c.reasoning, evidenceRef: c.evidence_ref })),
        };
      } catch (e) {
        return mapError(e);
      }
    },

    async saveDraft(reviewerId, deepId, revision, d, now = new Date()) {
      try {
        return (await pool.query("select save_deep_draft($1, $2, $3, $4, $5, $6) as r", [reviewerId, deepId, revision, d.extraWork, d.summary, now])).rows[0].r;
      } catch (e) {
        return mapError(e);
      }
    },

    async setDisposition(reviewerId, deepId, revision, noteNo, disposition, evidence, now = new Date()) {
      try {
        return (await pool.query("select set_disposition($1, $2, $3, $4, $5, $6, $7) as r", [reviewerId, deepId, revision, noteNo, disposition, evidence, now])).rows[0].r;
      } catch (e) {
        return mapError(e);
      }
    },

    async setChecklist(reviewerId, deepId, revision, item, result, reasoning, evidence, now = new Date()) {
      try {
        return (await pool.query("select set_checklist($1, $2, $3, $4, $5, $6, $7, $8) as r", [reviewerId, deepId, revision, item, result, reasoning, evidence, now])).rows[0].r;
      } catch (e) {
        return mapError(e);
      }
    },

    async decide(reviewerId, deepId, revision, decision, reason, attest, now = new Date()) {
      try {
        const { rows } = await pool.query("select * from decide_deep($1, $2, $3, $4, $5, $6, $7)", [reviewerId, deepId, revision, decision, reason, attest, now]);
        return { outcome: rows[0].outcome, verificationId: rows[0].verification_id ?? null, code: rows[0].code ?? null };
      } catch (e) {
        return mapError(e);
      }
    },

    async unassigned(actorId) {
      const { rows } = await pool.query("select * from deep_unassigned($1)", [actorId]);
      return rows.map((r) => ({ deepId: r.deep_id, createdAt: r.created_at.toISOString(), category: r.category }));
    },

    async inflight(actorId, now = new Date()) {
      const { rows } = await pool.query("select * from deep_inflight($1, $2)", [actorId, now]);
      return rows.map((r) => ({ deepId: r.deep_id, status: r.status, createdAt: r.created_at.toISOString(), category: r.category, reviewerId: r.reviewer_id, reviewerAuthorized: r.reviewer_authorized }));
    },

    async assign(actorId, deepId, reviewerId, now = new Date()) {
      try {
        await pool.query("select assign_deep($1, $2, $3, $4)", [actorId, deepId, reviewerId, now]);
      } catch (e) {
        mapError(e);
      }
    },

    async reassign(actorId, deepId, reviewerId, now = new Date()) {
      try {
        await pool.query("select reassign_deep($1, $2, $3, $4)", [actorId, deepId, reviewerId, now]);
      } catch (e) {
        mapError(e);
      }
    },
  };
}

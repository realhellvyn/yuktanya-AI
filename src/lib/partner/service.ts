import type { Pool } from "pg";
import { deepReadiness, standardReadiness } from "./readiness";

export type TeamMember = {
  firmId: string; firmName: string; reviewerId: string; email: string;
  activeStandard: number; activeDeep: number; authorized: boolean;
  authorization: { validFrom: string; validTo: string; revoked: boolean } | null;
};
export type ApprovalItem = {
  kind: "STANDARD" | "DEEP"; id: string; href: string; title: string; category: string; versionNo: number; status: string;
  ready: boolean; reasons: string[];
};

export interface PartnerService {
  // Reviewer di firma tempat aktor menjadi koordinator. Aktor lain (termasuk admin platform) mendapat daftar kosong.
  team(actorId: string, now?: Date): Promise<TeamMember[]>;
  // Pekerjaan aktif milik reviewer ini beserta alasan bila belum siap diputuskan.
  approvals(reviewerId: string, now?: Date): Promise<ApprovalItem[]>;
}

export function createPgPartnerService(pool: Pool): PartnerService {
  return {
    async team(actorId, now = new Date()) {
      const { rows } = await pool.query(
        `select m.firm_id, f.name as firm_name, m.user_id, u.email::text as email,
                (select count(*) from review_assignments a join review_requests r on r.id = a.request_id
                  where a.reviewer_id = m.user_id and a.status = 'ACTIVE' and r.firm_id = m.firm_id)::int as active_standard,
                (select count(*) from deep_assignments a join deep_requests d on d.id = a.deep_id
                  where a.reviewer_id = m.user_id and a.status = 'ACTIVE' and d.firm_id = m.firm_id)::int as active_deep,
                reviewer_has_authority(m.user_id, m.firm_id, $2) as authorized,
                to_char(pa.valid_from, 'YYYY-MM-DD') as valid_from, to_char(pa.valid_to, 'YYYY-MM-DD') as valid_to, pa.revoked_at
           from firm_members m
           join firms f on f.id = m.firm_id
           join auth.users u on u.id = m.user_id
           left join lateral (
             select a.valid_from, a.valid_to, a.revoked_at from professional_authorizations a
              where a.user_id = m.user_id and a.firm_id = m.firm_id
              order by (a.revoked_at is null and ($2 at time zone 'Asia/Jakarta')::date between a.valid_from and a.valid_to) desc,
                       (a.revoked_at is null) desc, a.valid_to desc, a.created_at desc
              limit 1) pa on true
          where m.role = 'reviewer'
            and exists (select 1 from firm_members c where c.firm_id = m.firm_id and c.user_id = $1 and c.role = 'coordinator')
          order by f.name, u.email`,
        [actorId, now],
      );
      return rows.map((r) => ({
        firmId: r.firm_id, firmName: r.firm_name, reviewerId: r.user_id, email: r.email ?? r.user_id.slice(0, 8),
        activeStandard: r.active_standard, activeDeep: r.active_deep, authorized: r.authorized,
        authorization: r.valid_from ? { validFrom: r.valid_from, validTo: r.valid_to, revoked: r.revoked_at !== null } : null,
      }));
    },

    async approvals(reviewerId, now = new Date()) {
      const std = await pool.query(
        `select r.id, r.status, d.title, d.category, v.version_no, coalesce(rp.scope, '') as scope, coalesce(rp.summary, '') as summary,
                coalesce((select json_agg(json_build_object('noteNo', n.note_no, 'severity', n.severity, 'actionable', n.actionable,
                           'recommendedAction', n.recommended_action, 'rationale', n.rationale, 'escalation', n.escalation) order by n.note_no)
                            from legal_notes n where n.report_id = rp.id), '[]'::json) as notes,
                r.firm_id is not null and reviewer_has_authority($1, r.firm_id, $2) as authorized
           from review_assignments a
           join review_requests r on r.id = a.request_id
           join document_versions v on v.id = r.version_id
           join documents d on d.id = v.document_id
           left join review_reports rp on rp.request_id = r.id
          where a.reviewer_id = $1 and a.status = 'ACTIVE' and r.status in ('ASSIGNED', 'IN_REVIEW')
          order by a.assigned_at`,
        [reviewerId, now],
      );
      const deep = await pool.query(
        `select dr.id, dr.status, d.title, d.category, v.version_no, coalesce(rp.extra_work, '') as extra_work,
                coalesce((select json_agg(json_build_object('item', c.item, 'result', c.result, 'reasoning', c.reasoning, 'evidenceRef', c.evidence_ref))
                            from deep_checklist c where c.report_id = rp.id), '[]'::json) as checklist,
                coalesce((select json_agg(json_build_object('noteNo', x.parent_note_no, 'disposition', x.disposition, 'evidence', x.evidence))
                            from deep_dispositions x where x.report_id = rp.id), '[]'::json) as dispositions,
                coalesce((select json_agg(json_build_object('noteNo', n.note_no, 'severity', n.severity, 'actionable', n.actionable))
                            from legal_notes n join review_reports prp on prp.id = n.report_id
                           where prp.request_id = dr.parent_request_id and n.status = 'PUBLISHED'), '[]'::json) as parent_notes,
                dr.firm_id is not null and reviewer_has_authority($1, dr.firm_id, $2) as authorized
           from deep_assignments a
           join deep_requests dr on dr.id = a.deep_id
           join document_versions v on v.id = dr.version_id
           join documents d on d.id = v.document_id
           left join deep_reports rp on rp.deep_id = dr.id
          where a.reviewer_id = $1 and a.status = 'ACTIVE' and dr.status in ('QUEUED', 'IN_REVIEW', 'READY_FOR_DECISION')
          order by a.assigned_at`,
        [reviewerId, now],
      );
      return [
        ...std.rows.map((r): ApprovalItem => ({
          kind: "STANDARD", id: r.id, href: `/partner/reviews/${r.id}`, title: r.title, category: r.category, versionNo: r.version_no, status: r.status,
          ...standardReadiness({ opened: r.status === "IN_REVIEW", authorized: r.authorized, scope: r.scope, summary: r.summary, notes: r.notes }),
        })),
        ...deep.rows.map((r): ApprovalItem => ({
          kind: "DEEP", id: r.id, href: `/partner/deep/${r.id}`, title: r.title, category: r.category, versionNo: r.version_no, status: r.status,
          ...deepReadiness({
            opened: r.status !== "QUEUED", authorized: r.authorized, extraWork: r.extra_work,
            checklist: r.checklist, dispositions: r.dispositions, parentNotes: r.parent_notes,
          }),
        })),
      ];
    },
  };
}

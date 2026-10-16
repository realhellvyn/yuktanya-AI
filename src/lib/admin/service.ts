import type { Pool } from "pg";
import type { Analytics } from "./analytics";

export type Overview = {
  range: { from: string; to: string };
  users: { registered: number; new: number; activated: number };
  ai: { requests: number; succeeded: number; failed: number; success_rate: number | null; p50_ms: number | null; p95_ms: number | null } | null;
  documents: { started: number; versions: number };
  funnel: { registered: number; ai_used: number; doc_started: number; version_created: number; review_requested: number; review_paid: number; review_completed: number };
  reviews: { unassigned: number; backlog_by_age: { lt_24h: number; d1_3: number; gt_3d: number }; completed: number; sla_median_hours: number | null; sla_p95_hours: number | null };
  revenue: { collected_by_kind: Record<string, number>; collected: number; held: number; refunds: number; net: number; fees: number; paying_users: number } | null;
  members: { active: number };
  incidents: { reconciliation: number; failed_outbox: number; ai_failures: number | null };
};
export type PartnerRow = {
  firmId: string; firmName: string; isDefault: boolean; userId: string | null; email: string | null; role: string | null;
  authorizationId: string | null; validFrom: string | null; validTo: string | null; revokedAt: string | null;
};

export interface AdminService {
  overview(adminId: string, from: Date, to: Date): Promise<Overview>;
  analytics(adminId: string, from: Date, to: Date, category: string | null, membership: string | null): Promise<Analytics>;
  partners(adminId: string): Promise<PartnerRow[]>;
  findUser(adminId: string, email: string): Promise<string | null>;
}

const day = (v: unknown) => (v instanceof Date ? v.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }) : (v as string | null));

export function createPgAdminService(pool: Pool): AdminService {
  return {
    async overview(adminId, from, to) {
      const { rows } = await pool.query("select admin_overview($1, $2, $3) as o", [adminId, from, to]);
      return rows[0].o as Overview;
    },
    async analytics(adminId, from, to, category, membership) {
      const { rows } = await pool.query("select admin_analytics($1, $2, $3, $4, $5) as a", [adminId, from, to, category, membership]);
      return rows[0].a as Analytics;
    },
    async partners(adminId) {
      const { rows } = await pool.query("select * from admin_list_partners($1)", [adminId]);
      return rows.map((r) => ({
        firmId: r.firm_id, firmName: r.firm_name, isDefault: r.is_default, userId: r.user_id, email: r.email, role: r.role, authorizationId: r.authorization_id,
        validFrom: day(r.valid_from), validTo: day(r.valid_to), revokedAt: r.revoked_at ? r.revoked_at.toISOString() : null,
      }));
    },
    async findUser(adminId, email) {
      return (await pool.query("select admin_find_user($1, $2) as id", [adminId, email])).rows[0].id ?? null;
    },
  };
}

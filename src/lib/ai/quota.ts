import type { Pool } from "pg";
import type { PlanKey } from "@/lib/pricing/catalog";

export type UsageKind = "MESSAGE" | "DOCUMENT" | "AI_REVIEW";
// AI_REVIEW_QUOTA_REACHED adalah pilihan rekayasa; v8 hanya menamai dua kode kuota lainnya.
export type QuotaCode = "AI_MESSAGE_QUOTA_REACHED" | "DOCUMENT_DAILY_QUOTA_REACHED" | "AI_REVIEW_QUOTA_REACHED";
export type ReserveResult =
  | { ok: true; groupId: string; duplicate: boolean }
  | { ok: false; code: QuotaCode; resetAt: string };

export type UsageSnapshot = {
  plan: PlanKey;
  messageLimit: number; messagesUsed: number; messagesRemaining: number;
  documentLimit: number; documentsUsed: number; documentsRemaining: number;
  aiReviewLimit: number; aiReviewsUsed: number; aiReviewsRemaining: number;
  resetAt: string;
};

export interface UsageStore {
  reserve(userId: string, kind: UsageKind, key: string, now?: Date): Promise<ReserveResult>;
  finalize(groupId: string): Promise<void>;
  release(groupId: string): Promise<void>;
  snapshot(userId: string, now?: Date): Promise<UsageSnapshot>;
}

const CODES: Record<string, QuotaCode> = {
  QUOTA_MESSAGE: "AI_MESSAGE_QUOTA_REACHED",
  QUOTA_DOCUMENT: "DOCUMENT_DAILY_QUOTA_REACHED",
  QUOTA_AI_REVIEW: "AI_REVIEW_QUOTA_REACHED",
};

export function createPgUsageStore(pool: Pool): UsageStore {
  return {
    async reserve(userId, kind, key, now = new Date()) {
      const { rows } = await pool.query("select status, group_id, reset_at from reserve_usage($1, $2, $3, $4)", [userId, kind, key, now]);
      const row = rows[0] as { status: string; group_id: string | null; reset_at: Date };
      if (row.status === "RESERVED" || row.status === "DUPLICATE") {
        return { ok: true, groupId: row.group_id as string, duplicate: row.status === "DUPLICATE" };
      }
      const code = CODES[row.status];
      if (!code) throw new Error(`Status reservasi tidak dikenal: ${row.status}`);
      return { ok: false, code, resetAt: row.reset_at.toISOString() };
    },

    async finalize(groupId) {
      await pool.query("select finalize_usage($1)", [groupId]);
    },

    async release(groupId) {
      await pool.query("select release_usage($1)", [groupId]);
    },

    async snapshot(userId, now = new Date()) {
      const { rows } = await pool.query(
        `select e.plan, e.messages, e.documents, e.ai_reviews,
                usage_count($1, wib_day($2), 'MESSAGE', $2) as m_used,
                usage_count($1, wib_day($2), 'DOCUMENT', $2) as d_used,
                usage_count($1, wib_day($2), 'REVIEW', $2) as r_used,
                ((wib_day($2) + 1)::timestamp at time zone 'Asia/Jakarta') as reset_at
           from resolve_entitlement($1, $2) e`,
        [userId, now],
      );
      const r = rows[0];
      const left = (limit: number, used: number) => Math.max(0, limit - used);
      return {
        plan: r.plan as PlanKey,
        messageLimit: r.messages, messagesUsed: r.m_used, messagesRemaining: left(r.messages, r.m_used),
        documentLimit: r.documents, documentsUsed: r.d_used, documentsRemaining: left(r.documents, r.d_used),
        aiReviewLimit: r.ai_reviews, aiReviewsUsed: r.r_used, aiReviewsRemaining: left(r.ai_reviews, r.r_used),
        resetAt: (r.reset_at as Date).toISOString(),
      };
    },
  };
}

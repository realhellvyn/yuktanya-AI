import type { Pool } from "pg";

export type MembershipState =
  | { active: false }
  | { active: true; periodStart: string; periodEnd: string; firstReviewUsed: boolean };

// Status untuk kartu akun: periode aktif sekarang dan apakah diskon review pertama periode ini sudah dipakai/dipesan.
export async function getMembershipState(pool: Pool, userId: string, now: Date = new Date()): Promise<MembershipState> {
  const { rows } = await pool.query(
    `select m.id, m.period_start, m.period_end,
            exists (select 1 from review_discount_entitlements e where e.membership_id = m.id and e.status in ('RESERVED', 'CONSUMED')) as used
       from memberships m
      where m.user_id = $1 and m.status = 'ACTIVE' and m.period_start <= $2 and $2 < m.period_end
      order by m.period_end desc limit 1`,
    [userId, now],
  );
  const r = rows[0];
  if (!r) return { active: false };
  return { active: true, periodStart: (r.period_start as Date).toISOString(), periodEnd: (r.period_end as Date).toISOString(), firstReviewUsed: r.used as boolean };
}

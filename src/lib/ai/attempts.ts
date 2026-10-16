import type { Pool } from "pg";

export type AttemptScope = "chat" | "assist";
export interface AttemptLimiter {
  // true = percobaan diizinkan dan dicatat; false = batas jendela terlampaui. Percobaan gagal tetap dihitung.
  allow(userId: string, scope: AttemptScope, now?: Date): Promise<boolean>;
}
export type AttemptLimits = Record<AttemptScope, { limit: number; windowSeconds: number }>;

// Batas rekayasa (bukan harga/kuota produk): menahan penyalahgunaan percobaan yang dikembalikan kuotanya.
export const DEFAULT_ATTEMPT_LIMITS: AttemptLimits = {
  chat: { limit: 40, windowSeconds: 600 },
  assist: { limit: 6, windowSeconds: 600 },
};

export function createPgAttemptLimiter(pool: Pool, limits: AttemptLimits = DEFAULT_ATTEMPT_LIMITS): AttemptLimiter {
  return {
    async allow(userId, scope, now = new Date()) {
      const { limit, windowSeconds } = limits[scope];
      const { rows } = await pool.query("select ai_attempt_allowed($1, $2, $3, $4, $5) as ok", [userId, scope, limit, windowSeconds, now]);
      return rows[0].ok === true;
    },
  };
}

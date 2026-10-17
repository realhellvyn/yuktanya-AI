import { randomUUID } from "node:crypto";

// Task 24 (A23): "satu panggilan AI aktif per pengguna" per jenis (percakapan dokumen, pemilih, analisis awal).
// Runtime memakai sewa singkat di database (ai_inflight_acquire/release, migrasi 41) agar berlaku lintas instance serverless;
// sebelumnya Set di memori per proses. Reservasi kuota atomik tetap mencegah pemakaian ganda; sewa ini membatasi beban upstream.
export type InflightScope = "chat" | "chooser" | "ai_review";
export interface InflightGuard {
  // Token pemegang bila sewa didapat; null bila panggilan lain milik pengguna ini masih berjalan.
  acquire(userId: string): Promise<string | null>;
  release(userId: string, token: string): Promise<void>;
}

// TTL = maxDuration rute/aksi AI (120 detik): fungsi yang mati di tengah jalan tidak mengunci pengguna lebih lama dari itu.
export const INFLIGHT_TTL_SECONDS = 120;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Queryable = { query(sql: string, args?: unknown[]): Promise<{ rows: any[] }> };

export function createPgInflight(pool: Queryable, scope: InflightScope, ttlSeconds = INFLIGHT_TTL_SECONDS): InflightGuard {
  return {
    async acquire(userId) {
      const token = randomUUID();
      const { rows } = await pool.query("select ai_inflight_acquire($1, $2, $3, $4) as ok", [userId, scope, token, ttlSeconds]);
      return rows[0]?.ok === true ? token : null;
    },
    async release(userId, token) {
      // Gagal melepas tidak menggagalkan permintaan: sewa kedaluwarsa sendiri setelah TTL.
      await pool.query("select ai_inflight_release($1, $2, $3)", [userId, scope, token]).catch(() => undefined);
    },
  };
}

// Versi dalam memori (satu proses) untuk uji.
export function memoryInflight(): InflightGuard & { held: Set<string> } {
  const held = new Set<string>();
  return {
    held,
    async acquire(userId) {
      if (held.has(userId)) return null;
      held.add(userId);
      return randomUUID();
    },
    async release(userId) {
      held.delete(userId);
    },
  };
}

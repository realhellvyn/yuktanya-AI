import { createHash } from "node:crypto";

// Task 24 (A07): pembatas laju umum berbasis Postgres (rate_limit_allowed, migrasi 41) agar berlaku lintas instance
// serverless; sebelumnya Map di memori per proses. Kunci (IP dari clientIp(), token, id pengguna) hanya disimpan sebagai
// hash SHA-256. Jendela tetap dengan jam database. Batas angka sama dengan pembatas memori sebelumnya.
//
// Kegagalan database pada pembatas (onDbError):
// - "open"  = permintaan tetap dilayani dan kejadian dicatat (tanpa kunci/IP). Halaman publik yang hanya membaca
//   (/verify, /s/[token]), webhook Midtrans (notifikasi sah tidak boleh ditolak hanya karena pembatas gagal; tanda tangan
//   + konfirmasi Get Status API tetap wajib), dan "Perbarui status" (jalurnya sendiri membutuhkan DB untuk membaca pembayaran,
//   jadi gangguan DB menghentikannya sebelum API Midtrans dipanggil).
// - "closed" = permintaan ditolak dengan pesan "terlalu sering/coba lagi". Konfirmasi baca (mengirim email/kode, menebak kode)
//   dan ekspor akun (beban berat, data pribadi): tanpa pembatas yang berfungsi lebih aman menolak; keduanya juga butuh DB.
export type RateScope = "verify_page" | "share_page" | "share_ack" | "account_export" | "midtrans_webhook" | "payment_refresh";
export type RateRule = { limit: number; windowSeconds: number; onDbError: "open" | "closed" };

export const RATE_RULES: Record<RateScope, RateRule> = {
  verify_page: { limit: 30, windowSeconds: 60, onDbError: "open" },
  share_page: { limit: 30, windowSeconds: 60, onDbError: "open" },
  share_ack: { limit: 10, windowSeconds: 60, onDbError: "closed" },
  account_export: { limit: 5, windowSeconds: 3600, onDbError: "closed" },
  midtrans_webhook: { limit: 120, windowSeconds: 60, onDbError: "open" },
  payment_refresh: { limit: 6, windowSeconds: 60, onDbError: "open" },
};

export interface RateLimiter {
  // true = boleh dilayani (dan dihitung); false = terlalu sering.
  allow(key: string): Promise<boolean>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Queryable = { query(sql: string, args?: unknown[]): Promise<{ rows: any[] }> };

export const rateLimitKey = (scope: RateScope, key: string): string =>
  createHash("sha256").update(`yuktanya-rl|${scope}|${key}`).digest("hex");

const defaultLog = (entry: Record<string, string>) => console.warn(JSON.stringify(entry));

// Fix round 1 (M5): kueri pembatas yang tidak selesai dalam 2 detik (DB lambat, pool penuh) diperlakukan sama dengan DB gagal,
// sehingga webhook dan halaman publik tidak tertahan pembatas. Kueri itu tetap berjalan di latar dan hasilnya diabaikan.
export const RATE_LIMIT_TIMEOUT_MS = 2_000;
class LimiterTimeout extends Error {
  constructor() {
    super("TIMEOUT");
    this.name = "TIMEOUT";
  }
}

export function createPgRateLimiter(pool: Queryable, scope: RateScope, rule: RateRule = RATE_RULES[scope], log = defaultLog, timeoutMs = RATE_LIMIT_TIMEOUT_MS): RateLimiter {
  return {
    async allow(key) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const query = pool.query("select rate_limit_allowed($1, $2, $3, $4) as ok", [scope, rateLimitKey(scope, key), rule.limit, rule.windowSeconds]);
        query.catch(() => undefined); // kueri yang kalah balapan tidak boleh menjadi penolakan tak tertangani
        const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new LimiterTimeout()), timeoutMs); });
        const { rows } = await Promise.race([query, timeout]);
        return rows[0]?.ok === true;
      } catch (e) {
        // Hanya cakupan, kebijakan, dan nama galat; kunci/IP tidak pernah dicatat.
        log({ event: "rate_limit_unavailable", scope, policy: rule.onDbError, error: e instanceof Error ? e.name : "unknown" });
        return rule.onDbError === "open";
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

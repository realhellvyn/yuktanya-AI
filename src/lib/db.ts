import "server-only";
import { Pool } from "pg";

let pool: Pool | undefined;

// Fix round 1 (M5): connectionTimeoutMillis 5 detik. Tanpa batas, permintaan menunggu koneksi selamanya bila database tidak
// dapat dijangkau atau kelima koneksi tersita (pg-pool juga menerapkannya pada antrean menunggu koneksi bebas). Dampak pada
// pemanggil lain: kueri yang dulu menggantung kini gagal setelah 5 detik dengan galat biasa (alur galat yang sudah ada).
export const poolConfig = (connectionString: string) => ({ connectionString, max: 5, connectionTimeoutMillis: 5_000 });

// Koneksi server-only ke Postgres (DATABASE_URL). Dipakai untuk fungsi kuota/atribusi.
export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL belum diset");
    pool = new Pool(poolConfig(connectionString));
  }
  return pool;
}

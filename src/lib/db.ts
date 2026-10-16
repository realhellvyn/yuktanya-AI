import "server-only";
import { Pool } from "pg";

let pool: Pool | undefined;

// Koneksi server-only ke Postgres (DATABASE_URL). Dipakai untuk fungsi kuota/atribusi.
export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL belum diset");
    pool = new Pool({ connectionString, max: 5 });
  }
  return pool;
}

import { cronAuthError } from "@/lib/jobs/cron-auth";

// Minimal agar tes unit dapat memakai palsu; pg.Pool memenuhinya.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Queryable = { query(sql: string, args?: unknown[]): Promise<{ rows: any[] }> };
export type RetentionResult = { ai_attempts: number; ack_challenges: number; rounds: number; more: boolean };

// Retensi terjadwal (bawaan rekayasa, menunggu persetujuan mitra hukum): ai_attempts > 30 hari, tantangan konfirmasi baca
// > 7 hari setelah kedaluwarsa. Setiap putaran dibatasi `batch` baris per tabel; berhenti saat habis atau `maxRounds` tercapai.
export async function runRetention(pool: Queryable, now: Date, opts: { batch?: number; maxRounds?: number } = {}): Promise<RetentionResult> {
  const batch = opts.batch ?? 5000;
  const maxRounds = opts.maxRounds ?? 10;
  const total: RetentionResult = { ai_attempts: 0, ack_challenges: 0, rounds: 0, more: true };
  while (total.more && total.rounds < maxRounds) {
    const { rows } = await pool.query("select run_retention($1, $2) as r", [now, batch]);
    const r = rows[0].r as { ai_attempts: number; ack_challenges: number; more: boolean };
    total.ai_attempts += r.ai_attempts;
    total.ack_challenges += r.ack_challenges;
    total.more = r.more;
    total.rounds++;
  }
  return total;
}

export async function retentionJobHandler(deps: { pool: Queryable; secret?: string; now?: () => Date }, req: Request): Promise<Response> {
  const denied = cronAuthError(deps.secret, req);
  if (denied) return denied;
  return Response.json(await runRetention(deps.pool, deps.now?.() ?? new Date()));
}

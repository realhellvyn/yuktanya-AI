import { cronAuthError } from "@/lib/jobs/cron-auth";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Queryable = { query(sql: string, args?: unknown[]): Promise<{ rows: any[] }> };

// Penyapuan terjadwal order yang lewat batas bayar: order → EXPIRED, diskon Member pertama yang dipesan dilepas, pembayaran
// PENDING → EXPIRED. Pembayaran yang datang kemudian tetap diproses settle_payment (dihidupkan kembali bila dana diterima tepat
// waktu, selain itu masuk rekonsiliasi). Autentikasi sama dengan job outbox/retensi.
export async function expireOrdersJobHandler(deps: { pool: Queryable; secret?: string; now?: () => Date }, req: Request): Promise<Response> {
  const denied = cronAuthError(deps.secret, req);
  if (denied) return denied;
  const { rows } = await deps.pool.query("select expire_orders($1) as n", [deps.now?.() ?? new Date()]);
  return Response.json({ expired: Number(rows[0].n) });
}

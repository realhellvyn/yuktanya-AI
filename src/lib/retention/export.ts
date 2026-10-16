import { wibDate } from "@/lib/documents/format";

// Minimal agar tes unit dapat memakai palsu; pg.Pool memenuhinya.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Queryable = { query(sql: string, args?: unknown[]): Promise<{ rows: any[] }> };

// Ekspor data milik sendiri. Isi ditentukan fungsi DB export_account_data (daftar-izin kolom, diuji isolasinya).
export async function loadAccountExport(pool: Queryable, userId: string, now: Date = new Date()): Promise<Record<string, unknown>> {
  const { rows } = await pool.query("select export_account_data($1, $2) as j", [userId, now]);
  return rows[0].j as Record<string, unknown>;
}

export const EXPORT_MAX_BYTES = 20 * 1024 * 1024;

// Kegagalan dialihkan (303) ke halaman dengan pesan biasa, bukan JSON galat, agar browser tidak menyimpannya sebagai berkas.
export async function accountExportHandler(deps: {
  getUserId: () => Promise<string | null>;
  load: (userId: string, now: Date) => Promise<Record<string, unknown>>;
  allow: (userId: string) => boolean;
  maxBytes?: number;
  now?: () => Date;
}, req: Request): Promise<Response> {
  const to = (path: string) => Response.redirect(new URL(path, req.url), 303);
  const userId = await deps.getUserId();
  if (!userId) return to("/login?returnTo=%2Fsettings");
  if (!deps.allow(userId)) return to("/settings?notice=export-limit");
  const now = deps.now?.() ?? new Date();
  const body = JSON.stringify(await deps.load(userId, now), null, 2);
  if (Buffer.byteLength(body) > (deps.maxBytes ?? EXPORT_MAX_BYTES)) return to("/settings?notice=export-large");
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="data-yuktanya-${wibDate(now.toISOString())}.json"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

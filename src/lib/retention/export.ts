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

export async function accountExportHandler(deps: {
  getUserId: () => Promise<string | null>;
  load: (userId: string, now: Date) => Promise<Record<string, unknown>>;
  allow: (userId: string) => boolean;
  maxBytes?: number;
  now?: () => Date;
}): Promise<Response> {
  const userId = await deps.getUserId();
  if (!userId) return Response.json({ code: "AUTH_REQUIRED" }, { status: 401 });
  if (!deps.allow(userId)) return Response.json({ code: "RATE_LIMITED", message: "Terlalu sering mengunduh. Coba lagi dalam satu jam." }, { status: 429 });
  const now = deps.now?.() ?? new Date();
  const body = JSON.stringify(await deps.load(userId, now), null, 2);
  if (Buffer.byteLength(body) > (deps.maxBytes ?? EXPORT_MAX_BYTES)) {
    return Response.json({ code: "TOO_LARGE", message: "Data terlalu besar untuk diunduh sekaligus. Hubungi bantuan." }, { status: 413 });
  }
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

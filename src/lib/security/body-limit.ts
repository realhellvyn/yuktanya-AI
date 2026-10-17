// Task 24 (A24 M1): Next hanya punya satu `serverActions.bodySizeLimit` global (next.config.ts, 5 MB untuk unggahan) dan tidak
// mendukung batas per aksi. Proxy menolak (413) POST ke halaman selain halaman unggahan bila Content-Length di atas 1 MB
// (batas bawaan Next untuk server action sebelum Task 6 menaikkannya). Rute API (/api/*) membaca badan dengan batasnya sendiri
// (mis. webhook Midtrans).
// PENTING (Fix round 1, M3): pemeriksaan ini hanya pertahanan berlapis (advisory), bukan batas per aksi yang sebenarnya. Next
// merutekan server action lewat header Next-Action, bukan lewat jalur URL, sehingga POST ke jalur unggahan dapat membawa id aksi
// lain, dan permintaan tanpa Content-Length tidak diperiksa di sini. Batas keras tetap batas global Next (5 MB), batas platform
// Vercel (±4,5 MB), dan validasi ukuran/isi di tiap aksi.
export const ACTION_BODY_LIMIT_BYTES = 1024 * 1024;
export const UPLOAD_ACTION_PATHS: readonly string[] = ["/documents/upload"];

export function oversizedActionBody(method: string, pathname: string, contentLength: string | null): boolean {
  if (method !== "POST" || pathname.startsWith("/api/") || UPLOAD_ACTION_PATHS.includes(pathname.replace(/\/+$/, ""))) return false;
  if (!contentLength || !/^\d+$/.test(contentLength.trim())) return false;
  return Number(contentLength) > ACTION_BODY_LIMIT_BYTES;
}

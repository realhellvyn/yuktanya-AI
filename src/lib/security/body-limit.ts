// Task 24 (A24 M1): Next hanya punya satu `serverActions.bodySizeLimit` global (next.config.ts, 6 MB untuk unggahan) dan tidak
// mendukung batas per aksi. Karena itu proxy menolak (413) POST ke halaman selain halaman unggahan bila Content-Length di atas
// 1 MB (batas bawaan Next untuk server action sebelum Task 6 menaikkannya). Rute API (/api/*) membaca badan dengan batasnya
// sendiri (mis. webhook Midtrans). Permintaan tanpa Content-Length tetap dibatasi 6 MB oleh Next dan validasi di tiap aksi.
export const ACTION_BODY_LIMIT_BYTES = 1024 * 1024;
export const UPLOAD_ACTION_PATHS: readonly string[] = ["/documents/upload"];

export function oversizedActionBody(method: string, pathname: string, contentLength: string | null): boolean {
  if (method !== "POST" || pathname.startsWith("/api/") || UPLOAD_ACTION_PATHS.includes(pathname.replace(/\/+$/, ""))) return false;
  if (!contentLength || !/^\d+$/.test(contentLength.trim())) return false;
  return Number(contentLength) > ACTION_BODY_LIMIT_BYTES;
}

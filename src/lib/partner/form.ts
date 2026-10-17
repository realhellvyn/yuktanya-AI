// Validasi field formulir aksi mitra sebelum menyentuh database. ID rusak atau revisi bukan angka tidak boleh
// menjadi galat server mentah: aksi mengalihkan dengan kode INVALID_REQUEST yang ditampilkan sebagai kalimat biasa.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const INVALID_FORM_TEXT = "Data formulir tidak valid. Muat ulang halaman, lalu coba lagi.";

export function formUuid(f: FormData, key: string): string | null {
  const v = f.get(key);
  return typeof v === "string" && UUID.test(v) ? v : null;
}

// Bilangan bulat dalam rentang [min, 1e9]; selain itu null.
export function formInt(f: FormData, key: string, min = 0): number | null {
  const v = f.get(key);
  if (typeof v !== "string" || !/^\d{1,9}$/.test(v.trim())) return null;
  const n = Number(v.trim());
  return n >= min ? n : null;
}

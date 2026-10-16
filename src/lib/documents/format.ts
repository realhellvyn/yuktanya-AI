import { formatIdr } from "@/lib/pricing/catalog";

export class FormatError extends Error {
  constructor(message: string, public readonly field?: string) {
    super(message);
    this.name = "FormatError";
  }
}

export { formatIdr };

// Menerima "Rp5.000.000", "5.000.000", "5000000". Menolak desimal/koma, negatif, dan angka di luar rentang aman.
export function parseIdr(raw: string): number {
  const s = raw.trim().replace(/^rp\s*/i, "").trim();
  if (!/^(\d+|\d{1,3}(\.\d{3})+)$/.test(s)) throw new FormatError("Jumlah uang tidak valid. Contoh: Rp5.000.000");
  const n = Number(s.replace(/\./g, ""));
  if (!Number.isSafeInteger(n)) throw new FormatError("Jumlah uang terlalu besar");
  return n;
}

const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

function toIso(y: number, m: number, d: number): string {
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) throw new FormatError("Tanggal tidak ada di kalender");
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function parseDateId(raw: string): string {
  const s = raw.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return toIso(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return toIso(+m[3], +m[2], +m[1]);
  m = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/.exec(s);
  if (m) {
    const idx = MONTHS.findIndex((x) => x.toLowerCase() === m![2].toLowerCase());
    if (idx >= 0) return toIso(+m[3], idx + 1, +m[1]);
  }
  throw new FormatError("Tanggal tidak valid. Contoh: 16 Oktober 2026");
}

export function formatDateId(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new FormatError("Tanggal ISO tidak valid");
  return `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}`;
}

// Menambah bulan kalender pada tanggal ISO; hari dipotong ke akhir bulan tujuan (31 Jan + 1 bulan = 28/29 Feb).
export function addMonthsIso(iso: string, months: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new FormatError("Tanggal ISO tidak valid");
  const index = +m[1] * 12 + (+m[2] - 1) + months;
  const y = Math.floor(index / 12);
  const mo = (index % 12) + 1;
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return toIso(y, mo, Math.min(+m[3], last));
}

// Instan (ISO UTC) → tanggal ISO menurut WIB (UTC+7), agar tanggal tampil sama dengan hari pengguna.
export function wibDate(isoInstant: string): string {
  return new Date(new Date(isoInstant).getTime() + 7 * 3600_000).toISOString().slice(0, 10);
}

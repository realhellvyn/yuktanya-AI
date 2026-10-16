// Kueri dashboard analitik admin: rentang khusus (hari WIB penuh), filter, perbandingan periode, dan peringatan.
// Masukan divalidasi di sini dan diperiksa ulang di DB (admin_analytics).
import { fmtCount, NO_DATA } from "./format";

export const CATEGORIES = [
  { value: "NDA", label: "Perjanjian Kerahasiaan (NDA)" },
  { value: "PKS", label: "Perjanjian Kerja Sama" },
  { value: "UTANG_PIUTANG", label: "Perjanjian Utang Piutang" },
  { value: "UPLOAD", label: "Dokumen unggahan" },
] as const;
export const MEMBERSHIPS = [
  { value: "MEMBER", label: "Member" },
  { value: "FREE", label: "Gratis" },
] as const;
export type Category = (typeof CATEGORIES)[number]["value"];
export type Membership = (typeof MEMBERSHIPS)[number]["value"];

export type AnalyticsQuery = {
  from: Date; to: Date; prevFrom: Date; prevTo: Date; days: number; label: string;
  category: Category | null; membership: Membership | null;
  typed: { dari: string; sampai: string; r: string };
  error?: string;
};

const DAY = 86_400_000;
const MAX_DAYS = 366;
const ymdWib = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
const startWib = (ymd: string) => new Date(`${ymd}T00:00:00+07:00`);
const fmtDay = (ymd: string) => new Date(`${ymd}T12:00:00+07:00`).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" });

function validDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function parseAnalyticsQuery(q: { r?: string; dari?: string; sampai?: string; jenis?: string; anggota?: string }, now: Date = new Date()): AnalyticsQuery {
  const category = (CATEGORIES.find((c) => c.value === q.jenis)?.value ?? null) as Category | null;
  const membership = (MEMBERSHIPS.find((m) => m.value === q.anggota)?.value ?? null) as Membership | null;
  const typed = { dari: (q.dari ?? "").slice(0, 10), sampai: (q.sampai ?? "").slice(0, 10), r: q.r ?? "" };
  const today = ymdWib(now);
  const build = (fromYmd: string, toYmd: string, label: string, error?: string): AnalyticsQuery => {
    const from = startWib(fromYmd);
    const to = new Date(startWib(toYmd).getTime() + DAY);
    const days = Math.round((to.getTime() - from.getTime()) / DAY);
    return { from, to, prevFrom: new Date(from.getTime() - days * DAY), prevTo: from, days, label, category, membership, typed, ...(error ? { error } : {}) };
  };
  const preset = (r: string, error?: string) => {
    const n = r === "1" ? 1 : r === "30" ? 30 : 7;
    const fromYmd = ymdWib(new Date(startWib(today).getTime() - (n - 1) * DAY));
    return build(fromYmd, today, n === 1 ? "Hari ini" : `${n} hari terakhir`, error);
  };
  if (!q.dari && !q.sampai) return preset(q.r ?? "7");
  const fallback = (msg: string) => preset("7", `${msg} Menampilkan 7 hari terakhir.`);
  if (!q.dari || !q.sampai) return fallback("Isi keduanya: tanggal awal dan tanggal akhir.");
  if (!validDate(typed.dari) || !validDate(typed.sampai)) return fallback("Tanggal tidak valid. Pilih tanggal dari kalender.");
  if (typed.sampai < typed.dari) return fallback("Tanggal akhir tidak boleh sebelum tanggal awal. Tanggal akhir harus sama atau setelah tanggal awal.");
  if (typed.sampai > today) return fallback("Tanggal akhir tidak boleh setelah hari ini.");
  const span = Math.round((startWib(typed.sampai).getTime() - startWib(typed.dari).getTime()) / DAY) + 1;
  if (span > MAX_DAYS) return fallback(`Rentang paling panjang ${MAX_DAYS} hari.`);
  return build(typed.dari, typed.sampai, `${fmtDay(typed.dari)} sampai ${fmtDay(typed.sampai)}`);
}

export function compareText(cur: number | null | undefined, prev: number | null | undefined): string {
  if (cur === null || cur === undefined || prev === null || prev === undefined) return NO_DATA;
  if (prev === 0) return `Periode sebelumnya: ${fmtCount(0)}`;
  if (cur === prev) return `Sama dengan periode sebelumnya (${fmtCount(prev)})`;
  const pct = Math.round((Math.abs(cur - prev) / prev) * 100);
  return `${cur > prev ? "Naik" : "Turun"} ${pct}% dari periode sebelumnya (${fmtCount(prev)})`;
}

export type AlertsInput = {
  overdue_hours: number; overdue_reviews: number; overdue_deep: number; unassigned: number; paid_not_queued: number; reconciliation: number;
  ai_24h: { requests: number; failed: number; rate: number | string | null } | null; ai_rate_threshold: number | string; ai_min_requests: number;
};
export type Alert = { code: string; text: string };

export function buildAlerts(a: AlertsInput): Alert[] {
  const out: Alert[] = [];
  if (a.overdue_reviews > 0) out.push({ code: "REVIEW_OVERDUE", text: `${fmtCount(a.overdue_reviews)} Review Standar masih terbuka dengan usia permintaan lebih dari ${a.overdue_hours} jam. Periksa perutean dan beban reviewer.` });
  if (a.overdue_deep > 0) out.push({ code: "DEEP_OVERDUE", text: `${fmtCount(a.overdue_deep)} Pemeriksaan Mendalam menunggu lebih dari ${a.overdue_hours} jam.` });
  const rate = a.ai_24h?.rate === null || a.ai_24h?.rate === undefined ? null : Number(a.ai_24h.rate);
  if (a.ai_24h && rate !== null && a.ai_24h.requests >= a.ai_min_requests && rate >= Number(a.ai_rate_threshold)) {
    out.push({ code: "AI_ERRORS", text: `Galat AI 24 jam terakhir ${Math.round(rate * 100)}% (${fmtCount(a.ai_24h.failed)} dari ${fmtCount(a.ai_24h.requests)} permintaan). Periksa halaman Pemakaian AI.` });
  }
  if (a.paid_not_queued > 0) out.push({ code: "PAID_NOT_QUEUED", text: `${fmtCount(a.paid_not_queued)} order sudah dibayar tetapi belum masuk antrean review.` });
  if (a.reconciliation > 0) out.push({ code: "RECONCILIATION", text: `${fmtCount(a.reconciliation)} pembayaran perlu rekonsiliasi.` });
  return out;
}

export type SeriesKey = "new_users" | "docs_started" | "drafts_completed" | "ai_messages" | "ai_failed" | "reviews_requested" | "reviews_paid" | "reviews_completed" | "revenue";
export type Analytics = {
  range: { from: string; to: string };
  filters: { category: string | null; membership: string | null };
  days: string[];
  series: Record<SeriesKey, number[] | null>;
  totals: Record<SeriesKey, number | null>;
  quality: {
    reviews_by_outcome: Record<string, number>; legal_notes_published: number; verifications_issued: Record<string, number>;
    verifications_revoked: number; deep_by_outcome: Record<string, number>; ai_malformed: number | null; complaints: number | null;
  };
  alerts: AlertsInput;
};

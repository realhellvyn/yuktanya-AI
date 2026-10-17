// Teks dan logika tampilan Special Legal Case (murni, dapat diuji unit). Bahasa Indonesia formal dan ringkas.
import { fixedText } from "@/lib/query-text";
import type { CaseErrorCode, CaseStatus } from "./service";

export const CASE_STATUS_LABEL: Record<CaseStatus, string> = {
  SUBMITTED: "Diajukan, menunggu penilaian firma",
  TRIAGED: "Sedang dinilai firma hukum",
  QUOTED: "Penawaran dikirim",
  ACCEPTED: "Penawaran diterima",
  DECLINED: "Penawaran ditolak",
  CLOSED: "Ditutup",
};
export const CASE_STATUS_TONE: Record<CaseStatus, "info" | "success" | "warning" | "danger" | "neutral"> = {
  SUBMITTED: "info", TRIAGED: "info", QUOTED: "warning", ACCEPTED: "success", DECLINED: "neutral", CLOSED: "neutral",
};

export const CASE_ERROR_TEXT: Record<CaseErrorCode | "SPECIAL_CASE_OPEN", string> = {
  NOT_FOUND: "Kasus atau dokumen tidak ditemukan. Muat ulang halaman, lalu coba lagi.",
  FORBIDDEN: "Akun Anda tidak berwenang melakukan tindakan ini.",
  CONSENT_REQUIRED: "Persetujuan belum dicentang. Centang persetujuan, lalu kirim lagi.",
  SUMMARY_INVALID: "Ringkasan kebutuhan harus 20 sampai 2.000 karakter.",
  CASE_EXISTS: "Dokumen ini sudah memiliki pengajuan Special Legal Case yang masih berjalan.",
  INVALID_STATE: "Tindakan ini tidak dapat dilakukan pada tahap sekarang. Muat ulang halaman untuk melihat status terbaru.",
  CONFLICT_CHECK_REQUIRED: "Centang pernyataan bahwa pemeriksaan konflik kepentingan sudah dilakukan.",
  INVALID_AMOUNT: "Isi biaya dalam rupiah, minimal Rp1.000.",
  INVALID_SCOPE: "Ruang lingkup pekerjaan minimal 10 karakter.",
  INVALID_EXPIRY: "Tanggal berlaku penawaran harus setelah hari ini dan paling lama 90 hari.",
  QUOTE_EXPIRED: "Penawaran ini sudah kedaluwarsa. Tunggu penawaran baru dari firma.",
  STALE_QUOTE: "Firma sudah memperbarui penawaran. Baca penawaran terbaru sebelum memutuskan.",
  INVALID_FIRM: "Firma tidak ditemukan. Pilih firma lain.",
  SPECIAL_CASE_OPEN: "Dokumen ini sedang diajukan sebagai Special Legal Case. Legal Review tidak tersedia selama Special Legal Case masih berjalan.",
};
// Kode bisa datang dari alamat (?e=): hanya properti milik sendiri yang dibaca ("__proto__", "toString" -> kalimat umum).
export const caseErrorText = (code: unknown): string | null =>
  code ? fixedText(CASE_ERROR_TEXT, code) ?? "Tindakan belum berhasil. Muat ulang halaman, lalu coba lagi." : null;

export type Step = { label: string; state: "done" | "current" | "todo" };
// Tahapan untuk pemilik: Diajukan, Dinilai firma, Penawaran, Keputusan Anda.
export function caseTimeline(status: CaseStatus): Step[] {
  const labels = ["Diajukan", "Dinilai firma hukum", "Penawaran dikirim", "Keputusan Anda"];
  const at: Record<CaseStatus, number> = { SUBMITTED: 1, TRIAGED: 2, QUOTED: 3, ACCEPTED: 4, DECLINED: 4, CLOSED: 4 };
  const pos = at[status];
  return labels.map((label, i) => ({ label, state: i < pos ? "done" : i === pos ? "current" : "todo" }));
}

export const quoteExpired = (expiresAt: string | null | undefined, now: Date = new Date()) => !!expiresAt && now.getTime() >= new Date(expiresAt).getTime();

// Formulir penawaran mitra: nominal boleh memakai titik ("2.500.000"); tanggal berlaku = akhir hari itu WIB.
export function parseQuoteForm(input: { amount: string; scope: string; expiresOn: string }):
  | { ok: true; value: { amountIdr: number; scope: string; expiresAt: Date } }
  | { ok: false; code: "INVALID_AMOUNT" | "INVALID_SCOPE" | "INVALID_EXPIRY" } {
  const digits = input.amount.replace(/[.\s]|^Rp/gi, "");
  if (!/^\d{1,10}$/.test(digits)) return { ok: false, code: "INVALID_AMOUNT" };
  const amountIdr = Number(digits);
  if (amountIdr < 1000 || amountIdr > 1_000_000_000) return { ok: false, code: "INVALID_AMOUNT" };
  const scope = input.scope.trim();
  if (scope.length < 10 || scope.length > 2000) return { ok: false, code: "INVALID_SCOPE" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.expiresOn)) return { ok: false, code: "INVALID_EXPIRY" };
  const expiresAt = new Date(`${input.expiresOn}T23:59:59+07:00`);
  if (Number.isNaN(expiresAt.getTime())) return { ok: false, code: "INVALID_EXPIRY" };
  return { ok: true, value: { amountIdr, scope, expiresAt } };
}

export const formatWib = (iso: string) =>
  new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(iso)) + " WIB";

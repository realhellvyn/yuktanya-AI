import { formatIdr, PRICING } from "@/lib/pricing/catalog";
import { fixedText } from "@/lib/query-text";
import { BillingError } from "./service";

// Halaman admin pembayaran: kode hasil/galat di alamat → kalimat tetap. Kode mentah tidak pernah ditampilkan.
const RESULT = {
  SETTLED: "Pembayaran dikonfirmasi dan pesanan diaktifkan.", DUPLICATE: "Pembayaran ini sudah pernah dikonfirmasi.",
  AMOUNT_MISMATCH: "Jumlah tidak sama dengan pesanan. Pesanan ditandai untuk rekonsiliasi.", RECONCILIATION_REQUIRED: "Pesanan kedaluwarsa atau sudah dibayar. Ditandai untuk rekonsiliasi.",
  NOT_FOUND: "Pembayaran tidak ditemukan.",
  ACTIVATED: "Pesanan diaktifkan setelah rekonsiliasi.", REFUND_RECORDED: "Pengembalian dana dicatat. Lakukan transfer pengembalian di luar sistem.", CLOSED: "Pesanan ditutup.",
};
const ERROR = {
  DISCOUNT_TAKEN: `Harga Legal Review pertama ${formatIdr(PRICING.standard.memberFirst)} untuk periode ini sudah dipakai pesanan lain, sehingga pesanan ini tidak dapat diaktifkan. Catat pengembalian dana.`,
  NOT_RECONCILIATION: "Pesanan ini sudah tidak perlu direkonsiliasi.", AMOUNT_MISMATCH: "Jumlah yang diterima tidak sama dengan pesanan. Pesanan tidak dapat diaktifkan.",
  CONFLICT: "Versi dokumen ini sudah memiliki pesanan pemeriksaan lain yang aktif.", NOT_ELIGIBLE: "Legal Review induk sudah berubah, sehingga pesanan tidak dapat diaktifkan.",
  NOTE_REQUIRED: "Catatan wajib diisi, minimal 5 karakter.",
  INVALID: "Data belum benar. Jumlah harus angka bulat lebih dari 0, referensi bank minimal 3 karakter, dan waktu dana diterima tidak boleh di masa depan.",
  FORBIDDEN: "Akun Anda tidak berwenang melakukan tindakan ini.",
  NOT_FOUND: "Pembayaran atau pesanan tidak ditemukan. Muat ulang halaman.",
  RACE: "Data ini baru saja diproses (mungkin oleh admin lain) atau referensi bank sudah dipakai. Muat ulang halaman, lalu periksa hasilnya sebelum mengulang.",
  INVALID_ACTION: "Pilihan tindakan tidak dikenal. Muat ulang halaman, lalu ulangi.",
};
const GENERIC_ERROR = "Tindakan belum berhasil. Muat ulang halaman, periksa data, lalu ulangi.";

export const adminPaymentResultText = (code: unknown): string | null => fixedText(RESULT, code) ?? null;
export const adminPaymentErrorText = (code: unknown): string | null =>
  typeof code === "string" && code ? fixedText(ERROR, code) ?? GENERIC_ERROR : null;

// Galat dari layanan → kode untuk alamat. null = galat tak terduga (dilempar ulang agar tercatat).
export function adminPaymentErrorCode(e: unknown): string | null {
  if (e instanceof BillingError) return e.code;
  if (e && typeof e === "object" && (e as { code?: unknown }).code === "23505") return "RACE";
  if (e instanceof Error && e.message.includes("INVALID_RECEIVED_AT")) return "INVALID";
  return null;
}

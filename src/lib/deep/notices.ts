// Pesan notifikasi pemesanan pemeriksaan mendalam. Nilai ?notice= dari alamat tidak pernah ditampilkan apa adanya:
// hanya kode yang dikenal dipetakan ke kalimat tetap; kode tidak dikenal tidak menampilkan apa pun.
const NOTICE: Record<string, string> = {
  PARENT_NOT_COMPLETED: "Pemeriksaan standar belum selesai.",
  NO_ACTIONABLE_NOTES: "Pemeriksaan standar tidak memiliki catatan yang perlu ditindaklanjuti.",
  PARENT_NOT_ACTIVE: "Verifikasi pemeriksaan standar sudah tidak aktif.",
  VERSION_MISMATCH: "Isi versi tidak cocok dengan versi yang diperiksa.",
  DEEP_EXISTS: "Pemeriksaan mendalam untuk pemeriksaan ini sudah dipesan atau selesai.",
  SPECIAL_CASE_OPEN: "Dokumen ini sedang ditangani sebagai Kasus Hukum Khusus, jadi pemeriksaan mendalam tidak ditawarkan.",
  PRODUCT_UNAVAILABLE: "Produk ini belum tersedia.",
  ORDER_NOT_PAYABLE: "Pesanan ini tidak dapat dibayar.",
  NOT_FOUND: "Pemeriksaan tidak ditemukan.",
  FORBIDDEN: "Anda tidak memiliki akses untuk memesan ini.",
  CONFLICT: "Data berubah saat diproses. Muat ulang halaman lalu coba lagi.",
};

export function deepNoticeText(notice: unknown): string | null {
  if (typeof notice !== "string" || !Object.hasOwn(NOTICE, notice)) return null;
  return `Pemeriksaan mendalam belum dapat dipesan. ${NOTICE[notice]}`;
}

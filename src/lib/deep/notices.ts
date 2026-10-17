// Pesan notifikasi pemesanan Deep Review. Nilai ?notice= dari alamat tidak pernah ditampilkan apa adanya:
// hanya kode yang dikenal dipetakan ke kalimat tetap; kode tidak dikenal tidak menampilkan apa pun.
const NOTICE: Record<string, string> = {
  PARENT_NOT_COMPLETED: "Legal Review belum selesai.",
  NO_ACTIONABLE_NOTES: "Legal Review ini tidak memuat Legal Note yang perlu ditindaklanjuti.",
  PARENT_NOT_ACTIVE: "Verifikasi Legal Review sudah tidak aktif.",
  VERSION_MISMATCH: "Isi versi tidak cocok dengan versi yang diperiksa.",
  DEEP_EXISTS: "Deep Review untuk Legal Review ini sudah dipesan atau sudah selesai.",
  SPECIAL_CASE_OPEN: "Dokumen ini sedang ditangani sebagai Kasus Hukum Khusus (Special Legal Case), sehingga Deep Review tidak ditawarkan.",
  PRODUCT_UNAVAILABLE: "Layanan ini belum tersedia.",
  ORDER_NOT_PAYABLE: "Pesanan ini tidak dapat dibayar.",
  NOT_FOUND: "Legal Review tidak ditemukan.",
  FORBIDDEN: "Akun Anda tidak memiliki akses untuk memesan layanan ini.",
  CONFLICT: "Data berubah saat diproses. Muat ulang halaman, lalu coba lagi.",
};

export function deepNoticeText(notice: unknown): string | null {
  if (typeof notice !== "string" || !Object.hasOwn(NOTICE, notice)) return null;
  return `Deep Review belum dapat dipesan. ${NOTICE[notice]}`;
}

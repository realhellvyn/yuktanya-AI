// Pesan tetap untuk halaman publik dan panel: teks dari URL tidak pernah ditampilkan, hanya kode yang dipetakan di sini.
export const ACK_RESULT_MESSAGES: Record<string, string> = {
  VERIFIED: "Terima kasih. Konfirmasi baca Anda sudah tercatat.",
  INVALID: "Kode belum sesuai. Periksa kembali kode di email Anda.",
  EXPIRED: "Kode sudah kedaluwarsa. Minta kode baru.",
  LOCKED: "Terlalu banyak percobaan. Minta kode baru setelah beberapa saat.",
  NOT_FOUND: "Tautan tidak ditemukan atau sudah tidak berlaku.",
};

export const ACK_ERROR_MESSAGES: Record<string, string> = {
  email: "Alamat email belum benar. Contoh: nama@contoh.com",
  rate: "Terlalu banyak permintaan kode. Coba lagi nanti.",
  busy: "Terlalu banyak permintaan. Coba lagi sebentar.",
};

export const PANEL_NOTICES: Record<string, string> = {
  rate: "Paket bukti baru dapat dibuat lagi setelah satu menit.",
  feature: "Fitur ini tersedia untuk Member.",
  expiry: "Masa berlaku tautan tidak valid.",
  offsets: "Pilih 1 sampai 5 hari pengingat.",
};

export const ASSIST_NOTICES: Record<string, string> = {
  ok: "AI mengisi sebagian kolom dari cerita Anda. Periksa setiap jawaban sebelum membuat dokumen.",
  none: "AI tidak menemukan isian yang tertulis jelas di cerita Anda. Silakan isi satu per satu.",
  manual: "AI belum dapat membaca cerita Anda. Silakan isi satu per satu; kuota Anda tidak terpakai.",
  quota: "Batas pesan AI hari ini sudah tercapai. Anda tetap dapat mengisi satu per satu.",
  busy: "Masih ada permintaan AI yang berjalan. Coba lagi sebentar.",
  down: "Layanan AI sedang sibuk. Jawaban Anda aman; coba lagi atau isi satu per satu.",
};

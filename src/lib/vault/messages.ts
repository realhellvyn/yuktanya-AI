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
  unavailable: "Konfirmasi baca lewat email belum tersedia karena layanan email belum aktif.",
};

export const PANEL_NOTICES: Record<string, string> = {
  rate: "Paket bukti baru dapat dibuat lagi setelah satu menit.",
  feature: "Fitur ini tersedia untuk Member.",
  expiry: "Masa berlaku tautan tidak valid.",
  offsets: "Pilih 1 sampai 5 hari pengingat.",
};

// Kode ringkas dari giliran percakapan → pesan tetap; teks dari URL tidak pernah ditampilkan.
export const CHAT_NOTICES: Record<string, string> = {
  quota: "Batas pesan AI hari ini sudah tercapai. Pesan terakhir belum terkirim. Percakapan sebelumnya tetap tersimpan dan bisa dilanjutkan besok mulai pukul 00.00 WIB.",
  busy: "Masih ada permintaan AI yang berjalan. Pesan terakhir belum terkirim; tunggu sebentar lalu kirim lagi.",
  down: "Layanan AI sedang sibuk. Pesan Anda sudah tersimpan dan jatah AI Anda tidak terpakai. Tekan Coba lagi.",
  stale: "Draf berubah di tab lain, jadi pesan Anda belum diproses. Tekan Coba lagi.",
  error: "Pesan belum dapat diproses. Periksa isinya, lalu kirim ulang.",
  limit: "Terlalu banyak percobaan dalam waktu singkat. Pesan terakhir belum terkirim; tunggu satu menit, lalu kirim lagi.",
  incomplete: "Masih ada kolom wajib yang belum terisi atau ada isian yang belum cocok. Lanjutkan percakapan agar lengkap.",
  docQuota: "Batas pembuatan dokumen baru hari ini sudah tercapai. Draf Anda aman, dan Anda bisa melanjutkan besok mulai pukul 00.00 WIB.",
  noTemplate: "Template ini belum tersedia.",
};

// Pesan tetap untuk halaman publik dan panel: teks dari URL tidak pernah ditampilkan, hanya kode yang dipetakan di sini.
export const ACK_RESULT_MESSAGES: Record<string, string> = {
  VERIFIED: "Terima kasih. Konfirmasi baca Anda sudah tercatat.",
  INVALID: "Kode tidak sesuai. Periksa kembali kode di email Anda.",
  EXPIRED: "Kode sudah kedaluwarsa. Tekan Kirim ulang kode untuk meminta kode baru.",
  LOCKED: "Terlalu banyak percobaan. Tunggu beberapa saat, lalu minta kode baru.",
  NOT_FOUND: "Tautan tidak ditemukan atau sudah tidak berlaku.",
};

export const ACK_ERROR_MESSAGES: Record<string, string> = {
  email: "Format email tidak sesuai. Contoh: nama@contoh.com",
  rate: "Permintaan kode terlalu sering. Coba lagi beberapa saat lagi.",
  busy: "Terlalu banyak permintaan. Tunggu sebentar, lalu coba lagi.",
  unavailable: "Konfirmasi baca lewat email belum tersedia karena layanan email belum aktif.",
};

export const PANEL_NOTICES: Record<string, string> = {
  rate: "Paket bukti baru dapat dibuat lagi setelah satu menit.",
  feature: "Fitur ini hanya tersedia untuk Member.",
  expiry: "Masa berlaku tautan tidak valid. Pilih 1, 7, atau 30 hari.",
  offsets: "Pilih paling sedikit satu waktu pengingat.",
};

// Kode ringkas dari giliran percakapan → pesan tetap; teks dari URL tidak pernah ditampilkan.
export const CHAT_NOTICES: Record<string, string> = {
  quota: "Kuota pesan AI hari ini sudah habis. Pesan terakhir Anda belum terkirim. Riwayat percakapan tetap tersimpan, dan kuota diperbarui pukul 00.00 WIB.",
  busy: "Permintaan AI sebelumnya masih diproses. Pesan terakhir Anda belum terkirim. Tunggu sebentar, lalu kirim lagi.",
  down: "Layanan AI sedang sibuk. Pesan Anda sudah tersimpan dan kuota AI Anda tidak terpakai. Tekan Coba lagi.",
  slow: "AI sedang lambat, jadi pesan Anda belum diproses. Pesan Anda sudah tersimpan dan kuota AI Anda tidak terpakai. Tekan Coba lagi.",
  stale: "Draf berubah di tab lain, sehingga pesan Anda belum diproses. Tekan Coba lagi.",
  error: "Pesan belum dapat diproses. Periksa isinya, lalu kirim ulang.",
  limit: "Terlalu banyak percobaan dalam waktu singkat. Pesan terakhir Anda belum terkirim. Tunggu satu menit, lalu kirim lagi.",
  incomplete: "Masih ada isian wajib yang kosong atau belum sesuai. Lanjutkan percakapan untuk melengkapinya.",
  docQuota: "Kuota dokumen baru hari ini sudah habis. Draf Anda tetap tersimpan, dan kuota diperbarui pukul 00.00 WIB.",
  noTemplate: "Jenis dokumen ini belum tersedia.",
};

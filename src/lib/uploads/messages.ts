// Pesan penolakan unggahan dalam Bahasa Indonesia sederhana.
export const UPLOAD_MESSAGES = {
  FEATURE_DISABLED: "Fitur sedang disiapkan. Belum ada berkas yang disimpan atau dikirim ke AI.",
  AUTH_REQUIRED: "Silakan masuk terlebih dahulu.",
  NO_FILE: "Pilih berkas terlebih dahulu.",
  NO_CONSENT: "Centang persetujuan terlebih dahulu. Tanpa persetujuan, dokumen tidak dikirim ke AI.",
  EMPTY: "Berkas kosong. Pilih berkas lain.",
  TOO_LARGE: "Berkas terlalu besar. Ukuran paling besar 5 MB.",
  UNSUPPORTED_TYPE: "Jenis berkas belum didukung. Gunakan PDF, Word (DOCX), atau teks (TXT).",
  TYPE_MISMATCH: "Isi berkas tidak sesuai dengan jenisnya. Simpan ulang berkas sebagai PDF, DOCX, atau TXT lalu coba lagi.",
  PARSE_FAILED: "Berkas tidak dapat dibaca. Mungkin rusak. Coba simpan ulang lalu unggah lagi.",
  ENCRYPTED: "Berkas dilindungi kata sandi. Buka kuncinya dulu, lalu unggah lagi.",
  SCANNED_PDF: "PDF ini berupa hasil pindai (gambar), jadi teksnya tidak dapat dibaca. Unggah versi Word (DOCX) atau PDF yang teksnya bisa dipilih.",
  TOO_MANY_PAGES: "Dokumen terlalu panjang untuk analisis awal. Batasnya 10 halaman (Member 20 halaman).",
  TOO_LONG: "Teks dokumen terlalu panjang untuk analisis awal. Pisahkan menjadi beberapa bagian atau ajukan penilaian khusus.",
  EMPTY_TEXT: "Tidak ada teks yang dapat dibaca di berkas ini.",
  ZIP_LIMIT: "Berkas Word ini tidak wajar (terlalu besar setelah dibuka). Simpan ulang dokumen lalu coba lagi.",
  DOCX_TOO_LARGE: "Isi dokumen Word ini terlalu besar untuk dibaca. Pisahkan menjadi beberapa bagian atau simpan sebagai PDF.",
  TIMEOUT: "Membaca berkas terlalu lama. Coba berkas yang lebih sederhana.",
  DOCUMENT_DAILY_QUOTA_REACHED: "Batas dokumen baru hari ini sudah tercapai. Coba lagi besok setelah pukul 00.00 WIB.",
  CONSENT_NOT_RECORDED: "Dokumen sudah tersimpan, tetapi persetujuan Anda belum dapat dicatat. Tidak ada yang dikirim ke AI. Buka dokumen Anda lalu coba analisis lagi nanti.",
  INTERNAL: "Terjadi gangguan. Berkas belum tersimpan. Silakan coba lagi.",
} as const;
export type UploadCode = keyof typeof UPLOAD_MESSAGES;

import type { Category } from "./types";

// Pilihan dokumen yang ditampilkan ke pemilik (Buat Dokumen dan pemilih "Saya belum tahu"). Sama dengan registri template.
export const DOC_OPTIONS: { category: Category; title: string; text: string; icon: string }[] = [
  { category: "PKS", title: "Perjanjian Kerja Sama", text: "untuk kerja sama usaha atau proyek", icon: "M8 12l3 3 5-6M4 6h16v12H4z" },
  { category: "UTANG_PIUTANG", title: "Surat Utang Piutang", text: "untuk pinjam-meminjam uang", icon: "M12 3v18M16 7H10a3 3 0 0 0 0 6h4a3 3 0 0 1 0 6H8" },
  { category: "NDA", title: "Perjanjian Kerahasiaan (NDA)", text: "untuk menjaga informasi rahasia", icon: "M5 10V7a7 7 0 0 1 14 0v3M4 10h16v11H4z" },
];

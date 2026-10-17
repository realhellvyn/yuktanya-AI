// Kode singkat hasil analisis AI untuk parameter URL halaman dokumen.
export type AiReviewStatus = "ok" | "quota" | "khusus" | "slow" | "down";
export function aiReviewStatus(status: number): AiReviewStatus {
  if (status === 200) return "ok";
  if (status === 429) return "quota";
  if (status === 409) return "khusus";
  // 504 = tenggat giliran AI habis (Task 24, A04).
  if (status === 504) return "slow";
  return "down";
}
export const AI_REVIEW_STATUS_TEXT: Record<AiReviewStatus, string> = {
  ok: "Analisis awal AI selesai. Hasilnya ada di bawah.",
  quota: "Batas analisis AI atau pesan AI hari ini sudah tercapai. Kuota Anda tidak terpakai. Coba lagi besok setelah pukul 00.00 WIB.",
  khusus: "Dokumen ini perlu dinilai melalui Kasus Hukum Khusus (Special Legal Case), jadi tidak dianalisis AI. Kuota Anda tidak terpakai.",
  slow: "AI sedang lambat. Analisis belum diproses dan kuota Anda tidak terpakai. Silakan coba lagi.",
  down: "Analisis AI belum berhasil. Kuota Anda tidak terpakai. Silakan coba lagi.",
};

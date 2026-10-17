// Kode singkat hasil analisis AI untuk parameter URL halaman dokumen.
export type AiReviewStatus = "ok" | "quota" | "khusus" | "down";
export function aiReviewStatus(status: number): AiReviewStatus {
  if (status === 200) return "ok";
  if (status === 429) return "quota";
  if (status === 409) return "khusus";
  return "down";
}
export const AI_REVIEW_STATUS_TEXT: Record<AiReviewStatus, string> = {
  ok: "Analisis awal AI selesai. Hasilnya ada di bawah.",
  quota: "Batas analisis AI atau pesan AI hari ini sudah tercapai. Kuota Anda tidak terpakai. Coba lagi besok setelah pukul 00.00 WIB.",
  khusus: "Dokumen ini perlu dinilai melalui Kasus Hukum Khusus (Special Legal Case), jadi tidak dianalisis AI. Kuota Anda tidak terpakai.",
  down: "Analisis AI belum berhasil. Kuota Anda tidak terpakai. Silakan coba lagi.",
};

// Kode singkat hasil analisis AI untuk parameter URL halaman dokumen.
export type AiReviewStatus = "ok" | "quota" | "khusus" | "slow" | "busy" | "limit" | "down";
export function aiReviewStatus(status: number): AiReviewStatus {
  if (status === 200) return "ok";
  if (status === 429) return "quota";
  if (status === 409) return "khusus";
  // 504 = tenggat giliran AI habis (Task 24, A04).
  if (status === 504) return "slow";
  return "down";
}
// Fix round 1 (M6): 429 dan 409 punya beberapa arti; kode di badan respons yang menentukan teksnya. AI_BUSY (sewa satu panggilan
// AI per pengguna sedang dipakai) dan DUPLICATE_REQUEST bukan kuota habis; TOO_MANY_ATTEMPTS adalah batas percobaan.
export async function aiReviewStatusOf(res: Response): Promise<AiReviewStatus> {
  if (res.status === 200) return "ok";
  const code = ((await res.clone().json().catch(() => null)) as { code?: unknown } | null)?.code;
  if (code === "AI_BUSY" || code === "DUPLICATE_REQUEST") return "busy";
  if (code === "TOO_MANY_ATTEMPTS") return "limit";
  if (code === "SPECIAL_CASE_REQUIRED") return "khusus";
  return aiReviewStatus(res.status);
}
export const AI_REVIEW_STATUS_TEXT: Record<AiReviewStatus, string> = {
  ok: "Analisis awal AI selesai. Hasilnya ada di bawah.",
  quota: "Batas analisis AI atau pesan AI hari ini sudah tercapai. Kuota Anda tidak terpakai. Coba lagi besok setelah pukul 00.00 WIB.",
  khusus: "Dokumen ini perlu dinilai melalui Kasus Hukum Khusus (Special Legal Case), jadi tidak dianalisis AI. Kuota Anda tidak terpakai.",
  busy: "Review AI untuk dokumen ini sedang berjalan. Tunggu hingga selesai.",
  limit: "Terlalu banyak percobaan analisis AI dalam waktu singkat. Kuota Anda tidak terpakai. Tunggu beberapa menit, lalu coba lagi.",
  slow: "AI sedang lambat. Analisis belum diproses dan kuota Anda tidak terpakai. Silakan coba lagi.",
  down: "Analisis AI belum berhasil. Kuota Anda tidak terpakai. Silakan coba lagi.",
};

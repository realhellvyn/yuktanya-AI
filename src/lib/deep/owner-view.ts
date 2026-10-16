// Tampilan sisi pemilik untuk Deep Review: murni (tanpa DB) agar mudah diuji.
export type StepState = "done" | "current" | "todo";
export type TimelineStep = { label: string; state: StepState };

const LABELS = ["Dipesan", "Dibayar", "Ditugaskan", "Diperiksa", "Selesai"];

// Deep Review baru ada setelah pembayaran terkonfirmasi, jadi "Dipesan" dan "Dibayar" selalu selesai.
export function deepTimeline({ status, assigned }: { status: string; assigned: boolean }): TimelineStep[] {
  const started = status === "IN_REVIEW" || status === "READY_FOR_DECISION";
  const doneCount = status === "COMPLETED" ? 5 : assigned || started ? 3 : 2;
  return LABELS.map((label, i) => ({
    label,
    state: i < doneCount ? "done" : i === doneCount && status !== "CANCELLED" ? "current" : "todo",
  }));
}

const NOT_ENHANCED: Record<string, string> = {
  COMPLETED_WITH_NOTES: "Profesional hukum menyelesaikan pemeriksaan, tetapi tidak semua syarat Enhanced terpenuhi. Hasil pemeriksaan standar Anda tetap berlaku untuk versi yang diperiksa.",
  INCONCLUSIVE: "Pemeriksaan belum dapat disimpulkan, jadi Enhanced tidak diberikan. Tidak ada lencana hukum baru untuk pemeriksaan ini.",
  REFERRED_SPECIAL_CASE: "Dokumen ini dirujuk sebagai kasus khusus. Biaya dan ruang lingkup ditentukan setelah asesmen profesional, dan Enhanced belum diberikan.",
};

export type EnhancedView = { enhanced: boolean; headline: string; text: string };

// Enhanced hanya diklaim berlaku bila keputusan APPROVE DAN lencananya sedang ACTIVE.
export function enhancedExplanation(outcome: string | null, decisionReason: string | null, verificationStatus: string | null = null): EnhancedView {
  if (outcome === "ENHANCED_APPROVED") {
    if (verificationStatus === "ACTIVE") {
      return { enhanced: true, headline: "Enhanced disetujui", text: "Profesional hukum yang berwenang menyelesaikan pemeriksaan tambahan dan memastikan semua syarat Enhanced terpenuhi, lengkap dengan bukti." };
    }
    if (verificationStatus === "SUSPENDED" || verificationStatus === "REVOKED") {
      const state = verificationStatus === "SUSPENDED" ? "ditangguhkan sementara" : "dicabut";
      return {
        enhanced: false,
        headline: verificationStatus === "SUSPENDED" ? "Enhanced ditangguhkan sementara" : "Enhanced dicabut",
        text: `Keputusan Enhanced pernah dicatat untuk pemeriksaan ini, tetapi lencananya sekarang ${state}. Biasanya ini terjadi karena verifikasi pemeriksaan standar yang menjadi dasarnya tidak lagi aktif. Lencana ini tidak boleh dipakai sebagai bukti sampai statusnya aktif kembali.`,
      };
    }
    return { enhanced: false, headline: "Enhanced belum berlaku", text: "Keputusan tercatat, tetapi tidak ada lencana Enhanced yang aktif untuk pemeriksaan ini." };
  }
  const base = NOT_ENHANCED[outcome ?? ""] ?? "Pemeriksaan ini belum menghasilkan Enhanced.";
  return { enhanced: false, headline: "Enhanced tidak diberikan", text: decisionReason ? `${base} Alasan dari profesional hukum: ${decisionReason}` : base };
}

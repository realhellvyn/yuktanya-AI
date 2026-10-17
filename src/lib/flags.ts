// Flag fitur dibaca dari env; nilai kosong/bukan "true" = mati (bawaan kode tetap false). Di produksi ketiganya AKTIF
// sejak 17 Okt 2026 atas keputusan pemilik (env Vercel, berlaku pada deploy berikutnya). Flag tidak pernah menggantikan
// auth, kuota, atau pemeriksaan profesional; Enhanced tetap butuh rubrik yang disetujui mitra (dicek di decide_deep).
export const flags = {
  get aiPreReview(): boolean {
    return process.env.AI_PREREVIEW_ENABLED === "true";
  },
  // Pembelian Deep Review dan penerbitan Enhanced: aktif di produksi sejak 17 Okt 2026 (keputusan pemilik).
  get deepReviewPurchase(): boolean {
    return process.env.DEEP_REVIEW_PURCHASE === "true";
  },
  get enhancedIssuance(): boolean {
    return process.env.ENHANCED_ISSUANCE === "true";
  },
};

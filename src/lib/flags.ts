// Flag produksi default OFF. Flag tidak pernah menggantikan auth, kuota, atau pemeriksaan profesional.
export const flags = {
  get aiPreReview(): boolean {
    return process.env.AI_PREREVIEW_ENABLED === "true";
  },
  // Pembelian Deep Review dan penerbitan Enhanced: default OFF di produksi sampai rubrik dan gerbang lain disetujui.
  get deepReviewPurchase(): boolean {
    return process.env.DEEP_REVIEW_PURCHASE === "true";
  },
  get enhancedIssuance(): boolean {
    return process.env.ENHANCED_ISSUANCE === "true";
  },
};

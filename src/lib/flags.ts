// Flag produksi default OFF. Flag tidak pernah menggantikan auth, kuota, atau pemeriksaan profesional.
export const flags = {
  get aiPreReview(): boolean {
    return process.env.AI_PREREVIEW_ENABLED === "true";
  },
};

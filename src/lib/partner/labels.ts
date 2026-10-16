export const CATEGORY: Record<string, string> = { PKS: "Perjanjian Kerja Sama", UTANG_PIUTANG: "Surat Utang Piutang", NDA: "Perjanjian Kerahasiaan (NDA)" };
export const categoryLabel = (c: string) => CATEGORY[c] ?? c;
export const ageHours = (iso: string, now: number = Date.now()) => `${Math.max(0, Math.floor((now - new Date(iso).getTime()) / 3_600_000))} jam`;
export const SEVERITY: Record<string, string> = { INFO: "Informasi", MINOR: "Perlu diperhatikan", MATERIAL: "Penting", CRITICAL: "Sangat penting" };

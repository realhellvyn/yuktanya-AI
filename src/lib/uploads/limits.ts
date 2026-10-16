import type { PlanKey } from "@/lib/pricing/catalog";

// Batas unggahan untuk analisis awal AI (docs/AI_FAIR_USAGE.md): ukuran berkas, halaman per paket, dan panjang teks.
// Batas karakter adalah default rekayasa (±3.000 karakter per halaman) sampai ada benchmark nyata.
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const UPLOAD_LIMITS: Record<PlanKey, { maxPages: number; maxChars: number }> = {
  FREE: { maxPages: 10, maxChars: 30_000 },
  MEMBER: { maxPages: 20, maxChars: 60_000 },
};
export const PARSE_TIMEOUT_MS = 10_000;
// Pengaman ZIP (DOCX): jumlah entri, ukuran terdeklarasi, dan rasio kompresi.
export const MAX_ZIP_ENTRIES = 300;
export const MAX_ZIP_ENTRY_BYTES = 8 * 1024 * 1024;
export const MAX_ZIP_TOTAL_BYTES = 20 * 1024 * 1024;
export const MAX_ZIP_RATIO = 100;
export const ZIP_RATIO_MIN_BYTES = 1024 * 1024;
export const ACCEPTED_EXTENSIONS = [".pdf", ".docx", ".txt"] as const;

import type { VerificationKind } from "@/lib/copy";

// Lencana medali (Task 20, keputusan pemilik 17 Okt 2026). Medali HANYA memvisualkan rekaman verifikasi yang sudah ada;
// tidak ada tingkat atau aturan penerbitan baru. Tingkat ditentukan dari jenis + status + hasil yang dikirim server:
// - bronze: rekaman AI Verified (kind AI, hanya diterbitkan server untuk dokumen unggahan).
// - silver: Legal Verified dari Legal Review yang selesai dan berwenang (WITH_NOTES / WITHIN_SCOPE).
// - gold:   Legal Verified Enhanced (kind LEGAL_ENHANCED, hasil ENHANCED_APPROVED).
// Status selain Aktif (dicabut, ditangguhkan) tidak pernah bermedali; teks status yang ada tetap tampil.
export type MedalTier = "bronze" | "silver" | "gold";

// Tulisan pada medali. Bronze tidak boleh memuat kata "Legal", "Sah", atau "Terjamin" (diuji).
// Judul resmi lengkap tetap VERIFICATION_TITLES di src/lib/copy.ts (juga dipakai ekspor DOCX/PDF).
export const MEDAL_TEXT = {
  bronze: { label: "AI Verified", note: "Pemeriksaan Awal oleh AI" },
  silver: { label: "Legal Verified", note: "Legal Review · Dengan Catatan" },
  gold: { label: "Legal Verified Enhanced", note: "Pemeriksaan lanjutan profesional" },
} as const;
export const SILVER_WITHIN_SCOPE_NOTE = "Legal Review · Sesuai Lingkup";
export type MedalNote = (typeof MEDAL_TEXT)[MedalTier]["note"] | typeof SILVER_WITHIN_SCOPE_NOTE;
export type Medal = { tier: MedalTier; note: MedalNote };

// status/kind bertipe string karena sebagian tampilan menerimanya apa adanya dari baris DB; nilai tak dikenal → tanpa medali.
export function medalFor(kind: VerificationKind | string, status: string, outcome: string | null): Medal | null {
  if (status !== "ACTIVE") return null;
  if (kind === "AI") return { tier: "bronze", note: MEDAL_TEXT.bronze.note };
  if (kind === "LEGAL") {
    if (outcome === "WITH_NOTES") return { tier: "silver", note: MEDAL_TEXT.silver.note };
    if (outcome === "WITHIN_SCOPE") return { tier: "silver", note: SILVER_WITHIN_SCOPE_NOTE };
    return null;
  }
  if (kind === "LEGAL_ENHANCED" && outcome === "ENHANCED_APPROVED") return { tier: "gold", note: MEDAL_TEXT.gold.note };
  return null;
}

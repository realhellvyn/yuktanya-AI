// Katalog event produk v8 (sumber: docs/ADMIN_DASHBOARD.md, "Minimal event instrumentation" + "v8 — revenue funnel").
// Dokumen menyebut 19 event minimal + 11 event v8, dua di antaranya sama → 28 nama unik.
// Event untuk tren/audit saja; angka dashboard tetap dihitung dari tabel sumber.
// Sumber "db": ditulis trigger DB pada transisi tepercaya (sekali per entitas, kunci dedupe, best-effort).
// Sumber "server": ditulis kode server lewat trackEvent (best-effort, nama dan metadata diperiksa ulang di DB).

export type EventSource = "db" | "server";
export type CatalogueEntry = { name: string; recordedAs: string; source: EventSource; when: string };

export const EVENT_CATALOGUE: readonly CatalogueEntry[] = [
  { name: "signup_completed", recordedAs: "signup_completed", source: "db", when: "profil dibuat (akun baru)" },
  { name: "ai_request_started", recordedAs: "ai_request_started", source: "server", when: "permintaan AI dimulai setelah kuota dipesan" },
  { name: "ai_request_succeeded", recordedAs: "ai_request_succeeded", source: "server", when: "jawaban AI diterima" },
  { name: "ai_request_failed", recordedAs: "ai_request_failed", source: "server", when: "gateway gagal atau keluaran rusak" },
  { name: "document_started", recordedAs: "document_started", source: "db", when: "dokumen dibuat" },
  { name: "draft_completed", recordedAs: "draft_completed", source: "db", when: "versi dokumen dibekukan" },
  { name: "review_requested", recordedAs: "review_requested", source: "db", when: "order Review Standar dibuat" },
  { name: "review_payment_verified", recordedAs: "review_payment_verified", source: "db", when: "pembayaran Review Standar terverifikasi" },
  { name: "review_assigned", recordedAs: "review_assigned", source: "db", when: "reviewer ditugaskan" },
  { name: "review_completed", recordedAs: "review_completed", source: "db", when: "Review Standar selesai" },
  { name: "special_case_submitted", recordedAs: "special_case_requested", source: "db", when: "kasus khusus diajukan (nama dari Task 5)" },
  { name: "quote_sent", recordedAs: "special_case_quote_sent", source: "db", when: "penawaran kasus khusus dikirim (nama dari Task 5)" },
  { name: "quote_accepted", recordedAs: "special_case_quote_accepted", source: "db", when: "penawaran kasus khusus diterima (nama dari Task 5)" },
  { name: "membership_activated", recordedAs: "membership_activated", source: "db", when: "periode Member aktif" },
  { name: "payment_refunded", recordedAs: "payment_refunded", source: "db", when: "pembayaran dicatat dikembalikan" },
  { name: "ai_verification_issued", recordedAs: "ai_verification_issued", source: "db", when: "AI Verified terbit" },
  { name: "legal_verification_issued", recordedAs: "legal_verification_issued", source: "db", when: "Legal Verified terbit" },
  { name: "legal_enhanced_verification_issued", recordedAs: "legal_enhanced_verification_issued", source: "db", when: "Enhanced terbit" },
  { name: "verification_revoked", recordedAs: "verification_revoked", source: "db", when: "verifikasi dicabut" },
  { name: "standard_completed", recordedAs: "standard_completed", source: "db", when: "Review Standar selesai (nama v8)" },
  { name: "legal_note_published", recordedAs: "legal_note_published", source: "db", when: "Legal Note diterbitkan" },
  { name: "deep_eligible", recordedAs: "deep_eligible", source: "db", when: "standar selesai dengan catatan aktionabel dan verifikasi aktif" },
  { name: "deep_offer_shown", recordedAs: "deep_offer_shown", source: "server", when: "penawaran Pemeriksaan Mendalam tampil ke pemilik yang layak" },
  { name: "deep_quote_accepted", recordedAs: "deep_quote_accepted", source: "db", when: "order Pemeriksaan Mendalam dibuat" },
  { name: "deep_payment_verified", recordedAs: "deep_payment_verified", source: "db", when: "pembayaran Pemeriksaan Mendalam terverifikasi" },
  { name: "deep_assigned", recordedAs: "deep_assigned", source: "db", when: "reviewer Pemeriksaan Mendalam ditugaskan" },
  { name: "deep_completed", recordedAs: "deep_completed", source: "db", when: "Pemeriksaan Mendalam selesai" },
  { name: "deep_approval_recorded", recordedAs: "deep_approval_recorded", source: "db", when: "keputusan reviewer Pemeriksaan Mendalam dicatat" },
];

// Event tambahan yang diminta brief (unggah, AI review) di luar daftar dokumen.
export const EXTRA_EVENTS: readonly CatalogueEntry[] = [
  { name: "document_uploaded", recordedAs: "document_uploaded", source: "db", when: "berkas unggahan tersimpan" },
  { name: "ai_review_completed", recordedAs: "ai_review_completed", source: "db", when: "laporan analisis awal AI tersimpan" },
];

// Catatan persetujuan (bukan analitik): wajib tercatat, ditulis lewat recordEvent yang ketat.
export const CONSENT_RECORDS = ["ai_review_consent_given", "document_upload_consent"] as const;

export const DOC_EVENT_NAMES: readonly string[] = EVENT_CATALOGUE.map((e) => e.name);
export const RECORDED_EVENT_NAMES: readonly string[] = [...EVENT_CATALOGUE, ...EXTRA_EVENTS].map((e) => e.recordedAs);
export type RecordedEventName = (typeof RECORDED_EVENT_NAMES)[number];

// Daftar-izin metadata: hanya kode/angka. Tidak ada judul, temuan, ringkasan, nama, email, prompt, atau alasan privat.
export const SAFE_METADATA_KEYS: readonly string[] = [
  "kind", "category", "outcome", "decision", "status", "severity", "actionable", "amount_idr", "latency_ms", "error_code", "task",
  "has_document", "revision", "version_no", "file_kind", "risk_level", "source", "reason_code", "plan_days", "consentVersion", "at",
];
const SAFE_STRING = /^[A-Za-z0-9_.:+-]{1,64}$/;

export type SafeMetadata = Record<string, string | number | boolean>;

export function sanitizeMetadata(m: Record<string, unknown> | undefined): SafeMetadata {
  const out: SafeMetadata = {};
  for (const [k, v] of Object.entries(m ?? {})) {
    if (!SAFE_METADATA_KEYS.includes(k)) continue;
    if (typeof v === "number" ? Number.isFinite(v) : typeof v === "boolean") out[k] = v as number | boolean;
    else if (typeof v === "string" && SAFE_STRING.test(v)) out[k] = v;
  }
  return out;
}

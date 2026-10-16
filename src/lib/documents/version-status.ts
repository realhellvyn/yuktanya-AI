import type { Pool } from "pg";

type VerificationStatus = "ACTIVE" | "REVOKED" | "SUSPENDED";
// Status pemeriksaan satu versi beku (D-04). review/outcome = permintaan pemeriksaan standar terbaru untuk versi itu.
export type VersionReviewState = {
  review: string | null; outcome: string | null; legal: VerificationStatus | null; enhanced: VerificationStatus | null; ai: boolean;
};

// Hanya versi dokumen milik pengguna; dokumen orang lain → objek kosong.
export async function versionStatuses(pool: Pick<Pool, "query">, userId: string, documentId: string): Promise<Record<string, VersionReviewState>> {
  const { rows } = await pool.query(
    `select v.id,
            rr.status as review, rr.outcome,
            (select dv.status from document_verifications dv where dv.version_id = v.id and dv.kind = 'LEGAL' order by dv.issued_at desc limit 1) as legal,
            (select dv.status from document_verifications dv where dv.version_id = v.id and dv.kind = 'LEGAL_ENHANCED' order by dv.issued_at desc limit 1) as enhanced,
            exists (select 1 from document_verifications dv where dv.version_id = v.id and dv.kind = 'AI' and dv.status = 'ACTIVE') as ai
       from document_versions v join documents d on d.id = v.document_id
       left join lateral (select r.status, r.outcome from review_requests r where r.version_id = v.id order by r.created_at desc limit 1) rr on true
      where d.id = $1 and d.owner_id = $2`,
    [documentId, userId],
  );
  return Object.fromEntries(rows.map((r) => [r.id, { review: r.review ?? null, outcome: r.outcome ?? null, legal: r.legal ?? null, enhanced: r.enhanced ?? null, ai: r.ai === true }]));
}

export type StatusTone = "info" | "success" | "warning" | "neutral" | "danger";
const LIVE = ["QUEUED", "ASSIGNED", "IN_REVIEW"];

// Teks status satu versi untuk pemilik. Badge hanya dari verifikasi hukum versi itu sendiri; versi suntingan tidak mewarisi.
// newerThanReviewed: ada versi lebih lama yang pernah diperiksa pengacara → versi ini disebut "Versi baru belum diperiksa".
export function versionStatusText(s: VersionReviewState | undefined, newerThanReviewed: boolean): { text: string; tone: StatusTone } {
  const notReviewed = { text: newerThanReviewed ? "Versi baru belum diperiksa" : "Belum diperiksa pengacara", tone: "warning" as const };
  if (!s) return notReviewed;
  if (s.legal === "ACTIVE") {
    return { text: s.enhanced === "ACTIVE" ? "Sudah diperiksa pengacara — Legal Verified Enhanced aktif" : "Sudah diperiksa pengacara — Legal Verified aktif", tone: "success" };
  }
  if (s.legal === "SUSPENDED") return { text: "Sudah diperiksa pengacara — verifikasi ditangguhkan sementara", tone: "warning" };
  if (s.legal === "REVOKED") return { text: "Sudah diperiksa pengacara — verifikasi dicabut", tone: "danger" };
  if (s.review && LIVE.includes(s.review)) return { text: "Sedang dalam pemeriksaan pengacara", tone: "info" };
  if (s.review === "COMPLETED" && s.outcome === "INCONCLUSIVE") return { text: "Sudah diperiksa pengacara — belum dapat disimpulkan, tanpa Legal Verified", tone: "neutral" };
  if (s.review === "DECLINED") return { text: "Pemeriksaan ditolak pemeriksa — versi ini belum diperiksa", tone: "neutral" };
  return notReviewed;
}

// Pernah diperiksa pengacara (selesai, termasuk yang verifikasinya kemudian dicabut).
export const wasReviewed = (s: VersionReviewState | undefined) => Boolean(s && (s.legal || s.review === "COMPLETED"));

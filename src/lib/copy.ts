// Salinan wajib dan konstanta teks bersama (Bahasa Indonesia formal dan ringkas). Konstanta yang ikut tercetak di ekspor
// (judul dan pernyataan verifikasi, VERIFIED_LABEL, LEGAL_DISCLAIMER, QR_NOT_SIGNATURE) sengaja tidak diubah Task 19.
export const SLOGAN = "Legal Service Seharga Secangkir Kopi.";
export const AI_DRAFT_LABEL = "Dibuat dengan bantuan AI. Belum diperiksa oleh profesional hukum.";
export const AI_PREREVIEW_LABEL = "Analisis awal AI bersifat informasional dan dapat keliru.";
// Persetujuan eksplisit sebelum teks dokumen dikirim ke gateway AI (docs/SECURITY_AND_LEGAL.md).
// Naikkan versinya setiap kali teks persetujuan berubah; versi ini dicatat di event persetujuan.
export const AI_REVIEW_CONSENT_VERSION = "ai-consent-v1";
export const AI_REVIEW_CONSENT =
  "Saya setuju teks dokumen ini dikirim ke gateway AI FreeLLMAPI milik Yuktanya, yang meneruskannya ke penyedia model AI pihak ketiga, untuk analisis awal.";
// Dokumen unggahan: kode verifikasi/QR mengikat teks hasil pembacaan berkas, bukan byte berkas asli.
export const UPLOAD_HASH_NOTE = "Kode ini untuk teks hasil pembacaan, bukan berkas asli.";
export const SPECIAL_CASE_NOTE = "Biaya dan ruang lingkup ditentukan setelah asesmen profesional.";
export const CHECKOUT_NOTE =
  "Pembayaran adalah biaya pemeriksaan. Pembayaran tidak menjamin hasil positif atau penerbitan verifikasi Enhanced.";
export const LEGAL_DISCLAIMER = "Tidak menjamin keabsahan atau hasil hukum dalam semua keadaan.";
// Label Verified wajib (docs/SECURITY_AND_LEGAL.md "Mandatory copy"; DECISIONS_AND_PRECEDENCE "Review integrity").
// Tampil bersama pernyataan VERIFICATION_POLICY pada setiap verifikasi hukum (LEGAL, LEGAL_ENHANCED) yang aktif.
export const VERIFIED_LABEL =
  "Dokumen versi ini telah diperiksa oleh profesional hukum sesuai ruang lingkup review yang tercantum. Tidak menjamin keabsahan atau hasil hukum tertentu.";

// Teks wajib hasil verifikasi (docs/VERIFICATION_POLICY.md). Tanpa kata "cap" di tampilan pengguna.
export const VERIFICATION_TITLES = {
  AI: "Yuktanya AI Verified — Pemeriksaan Awal oleh AI",
  LEGAL: "Yuktanya Legal Verified",
  LEGAL_ENHANCED: "Yuktanya Legal Verified — Enhanced",
} as const;
export type VerificationKind = keyof typeof VERIFICATION_TITLES;
export const VERIFICATION_STATEMENTS = {
  AI: "Analisis otomatis untuk versi dokumen ini telah selesai. Bukan pengesahan hukum dan belum diperiksa pengacara.",
  LEGAL_WITH_NOTES: "Pemeriksaan selesai dengan catatan. Baca catatan sebelum menggunakan dokumen.",
  LEGAL_WITHIN_SCOPE: "Pemeriksa menyatakan dokumen memenuhi kriteria dalam ruang lingkup pemeriksaan yang tercantum.",
  LEGAL_ENHANCED: "Versi ini telah melalui pemeriksaan tambahan oleh profesional hukum dan memenuhi kriteria material dalam lingkup yang tercantum.",
} as const;
// D-11: istilah Legal Note selalu dijelaskan saat pertama muncul di layar pemilik.
export const LEGAL_NOTE_TERM = "Legal Note (Catatan dari pemeriksa)";
export const LEGAL_NOTE_EXPLAINER =
  "Legal Note adalah catatan dari pemeriksa: bagian dokumen yang menurut pengacara perlu diperbaiki atau diperhatikan, beserta saran tindakannya.";
export const QR_NOT_SIGNATURE = "Kode QR hanya mengarah ke halaman pengecekan. Ini bukan tanda tangan.";
export const NEW_VERSION_NOT_REVIEWED = "Versi baru belum diperiksa";

export function verificationStatement(kind: VerificationKind, outcome: string | null): string {
  if (kind === "AI") return VERIFICATION_STATEMENTS.AI;
  if (kind === "LEGAL_ENHANCED") return VERIFICATION_STATEMENTS.LEGAL_ENHANCED;
  return outcome === "WITHIN_SCOPE" ? VERIFICATION_STATEMENTS.LEGAL_WITHIN_SCOPE : VERIFICATION_STATEMENTS.LEGAL_WITH_NOTES;
}
// Ditampilkan kepada pemilik sebelum dan sesudah membayar Deep Review selama rubrik Enhanced (RUBRIC_VERSION) belum
// dicatat disetujui di /admin/rubric. Pembelian tetap dibuka (keputusan pemilik 17 Okt 2026); kalimat ini mencegah
// tawaran yang menyiratkan Enhanced mungkin terbit padahal decide_deep pasti menolaknya.
export const ENHANCED_RUBRIC_PENDING =
  "Saat ini lencana Legal Verified Enhanced belum dapat diterbitkan karena pedoman pemeriksaan Enhanced belum disetujui. Deep Review tetap memberikan pemeriksaan lanjutan dan hasil tertulis dari pengacara.";
export const DEEP_PAYMENT_STATEMENT =
  "Pembayaran tidak menjamin Enhanced, kesimpulan yang menguntungkan, keabsahan hukum, atau hasil di pengadilan.";

// Teks blok verifikasi pada ekspor (baris dipisah "\n"): pernyataan kebijakan, lalu untuk verifikasi hukum label Verified
// dan penafian hukum.
export function exportVerificationStatement(kind: VerificationKind, outcome: string | null): string {
  const statement = verificationStatement(kind, outcome);
  return kind === "AI" ? statement : `${statement}\n${VERIFIED_LABEL}\n${LEGAL_DISCLAIMER}`;
}

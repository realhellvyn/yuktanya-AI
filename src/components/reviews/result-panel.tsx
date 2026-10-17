import Link from "next/link";
import { LEGAL_DISCLAIMER, LEGAL_NOTE_EXPLAINER, LEGAL_NOTE_TERM, NEW_VERSION_NOT_REVIEWED, QR_NOT_SIGNATURE, VERIFICATION_TITLES, VERIFIED_LABEL, verificationStatement } from "@/lib/copy";
import type { OwnerReview } from "@/lib/reviews/service";
import { LegalNoteCard } from "./legal-note-card";
import { VerificationMedal } from "@/components/verification/verification-medal";
import { medalFor } from "@/lib/verification/medal";

const OUTCOME_TITLE: Record<string, string> = {
  WITH_NOTES: "Selesai: dengan Legal Note",
  WITHIN_SCOPE: "Selesai: tanpa Legal Note",
  INCONCLUSIVE: "Selesai: belum dapat disimpulkan",
  DECLINED: "Tidak dapat diperiksa",
};
const link = "inline-flex min-h-12 items-center font-semibold text-link underline";
const day = (iso: string) => new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeZone: "Asia/Jakarta" }).format(new Date(iso));

export function ResultPanel({ review, verifyUrl, qrDataUrl, isLatestVersion = true, now = new Date() }: { review: OwnerReview; verifyUrl?: string; qrDataUrl?: string; isLatestVersion?: boolean; now?: Date }) {
  if (review.status === "CANCELLED") {
    return (
      <section aria-labelledby="hasil-h" className="space-y-3 rounded-lg border border-line bg-surface p-4">
        <h2 id="hasil-h" className="text-2xl font-semibold">Pengajuan dibatalkan</h2>
        <p>Pengajuan Legal Review ini dibatalkan, sehingga tidak ada hasil pemeriksaan untuk versi {review.versionNo}.</p>
        <p><Link className={link} href="/bantuan#pengacara">Baca cara mengajukan Legal Review</Link></p>
      </section>
    );
  }
  if (review.status !== "COMPLETED" && review.status !== "DECLINED") {
    return <p role="status" className="rounded-lg border border-line bg-surface p-4">Legal Review belum selesai. Hasilnya akan tampil di halaman ini.</p>;
  }
  const v = review.verification;
  const badge = v && (review.outcome === "WITH_NOTES" || review.outcome === "WITHIN_SCOPE");
  const medal = badge && v ? medalFor("LEGAL", v.status, review.outcome) : null;
  const declined = review.status === "DECLINED";
  // Kredit masih AVAILABLE di database tetapi sudah lewat expires_at: jangan dibaca seolah masih berlaku.
  const creditLapsed = !!review.credit && new Date(review.credit.expiresAt).getTime() <= now.getTime();
  const versionHref = `/documents/${review.documentId}?version=${review.versionId}`;
  return (
    <section aria-labelledby="hasil-h" className="space-y-4">
      <h2 id="hasil-h" className="text-2xl font-semibold">{OUTCOME_TITLE[review.outcome ?? ""] ?? "Selesai"}</h2>
      {review.outcome === "WITH_NOTES" && <p>{LEGAL_NOTE_EXPLAINER}</p>}
      <dl className="space-y-1">
        <div><dt className="inline font-semibold">Versi yang diperiksa: </dt><dd className="inline">versi {review.versionNo}</dd></div>
        <div><dt className="inline font-semibold">Diperiksa oleh: </dt><dd className="inline">{review.firmName ? `profesional hukum dari firma mitra ${review.firmName}` : "profesional hukum dari firma mitra Yuktanya"}</dd></div>
        {review.completedAt && <div><dt className="inline font-semibold">{declined ? "Diputuskan pada: " : "Selesai diperiksa pada: "}</dt><dd className="inline">{day(review.completedAt)}</dd></div>}
      </dl>
      {!isLatestVersion && <p role="status" className="rounded-lg border border-line bg-surface p-3">{NEW_VERSION_NOT_REVIEWED}. Hasil ini hanya berlaku untuk versi {review.versionNo}.</p>}
      {declined && (
        <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="font-semibold">Pengacara tidak dapat memeriksa dokumen ini, sehingga tidak ada hasil pemeriksaan dan tidak ada Legal Verified.</p>
          {review.credit?.status === "AVAILABLE" && !creditLapsed && (
            <p>Pesanan Anda dibatalkan dan pembayarannya diganti 1 kredit Legal Review, berlaku sampai {day(review.credit.expiresAt)}. Kredit ini otomatis dipakai saat Anda mengajukan Legal Review berikutnya, sehingga Anda tidak membayar lagi untuk Legal Review tersebut.</p>
          )}
          {review.credit?.status === "AVAILABLE" && creditLapsed && (
            <p>Pesanan Anda dibatalkan dan pembayarannya diganti 1 kredit Legal Review. Kredit tersebut sudah kedaluwarsa pada {day(review.credit.expiresAt)}, sehingga tidak dapat dipakai lagi.</p>
          )}
          {review.credit && review.credit.status !== "AVAILABLE" && (
            <p>Pesanan Anda dibatalkan dan pembayarannya diganti 1 kredit Legal Review. Kredit tersebut sudah terpakai atau sudah tidak berlaku.</p>
          )}
          {review.summary && <p>Alasan dari pengacara: {review.summary}</p>}
          <p>Langkah berikutnya: bila dokumen Anda rumit atau berisiko tinggi, ajukan Kasus Hukum Khusus (Special Legal Case).</p>
          <p><Link className={link} href={`/cases/new?document=${review.documentId}`}>Ajukan Special Legal Case</Link></p>
        </div>
      )}
      {review.outcome === "INCONCLUSIVE" && (
        <div className="space-y-2 rounded-lg border border-line bg-surface p-4">
          <p>Pengacara sudah memeriksa versi ini, tetapi belum dapat menarik kesimpulan, misalnya karena informasi yang tersedia tidak cukup. Baca ringkasan pengacara di bawah.</p>
          <p>Biaya pemeriksaan ini tetap tercatat lunas; sistem tidak membuat kredit atau pengembalian dana otomatis untuk hasil ini.</p>
          <p>Langkah berikutnya: lengkapi dokumen, lalu ajukan Legal Review untuk versi baru. Bila dokumen Anda rumit, ajukan Kasus Hukum Khusus (Special Legal Case).</p>
          <p><Link className={link} href={`/cases/new?document=${review.documentId}`}>Ajukan Special Legal Case</Link></p>
        </div>
      )}
      {!declined && review.scope && <div><h3 className="font-semibold">Ruang lingkup pemeriksaan</h3><p>{review.scope}</p></div>}
      {!declined && review.assumptions && <div><h3 className="font-semibold">Asumsi</h3><p>{review.assumptions}</p></div>}
      {!declined && review.summary && <div><h3 className="font-semibold">Ringkasan pengacara</h3><p>{review.summary}</p></div>}
      {review.notes.length > 0 && (
        <div className="space-y-3">
          <h3 id="catatan" className="text-xl font-semibold">{LEGAL_NOTE_TERM}</h3>
          {review.outcome !== "WITH_NOTES" && <p>{LEGAL_NOTE_EXPLAINER}</p>}
          {review.notes.map((n) => <LegalNoteCard key={n.noteNo} note={n} />)}
        </div>
      )}
      {badge && v && (
        <div className="space-y-2 rounded-lg border border-line bg-surface p-4">
          {medal && <VerificationMedal tier={medal.tier} note={medal.note} />}
          <h3 className="text-lg font-semibold">{VERIFICATION_TITLES.LEGAL}</h3>
          <p role="status" className="font-semibold">Status: {v.status === "ACTIVE" ? "Aktif" : v.status === "REVOKED" ? "Dicabut" : "Ditangguhkan sementara"}</p>
          <p>{verificationStatement("LEGAL", review.outcome)}</p>
          {v.status === "ACTIVE" && <p className="font-semibold">{VERIFIED_LABEL}</p>}
          {verifyUrl && <p>Cek di <a className="inline-flex min-h-12 items-center underline" href={verifyUrl}>{verifyUrl}</a></p>}
          <p>Kode: <span className="font-mono break-all">{v.code}</span></p>
          {qrDataUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qrDataUrl} alt="Kode QR pengecekan verifikasi" width={140} height={140} />
          )}
          <p>{QR_NOT_SIGNATURE}</p>
        </div>
      )}
      {!badge && <p>Legal Review ini tidak menghasilkan Yuktanya Legal Verified.</p>}
      {!declined && (
        <div className="space-y-1 rounded-lg border border-line bg-surface p-4">
          <h3 className="font-semibold">Unduh</h3>
          <p>Laporan pemeriksaan (ruang lingkup, ringkasan, dan Legal Note) belum tersedia sebagai berkas unduhan. Untuk menyimpannya, cetak atau simpan halaman ini.</p>
          <p>Dokumen versi {review.versionNo} dapat diunduh (Word atau PDF){badge && v?.status === "ACTIVE" ? " beserta kode verifikasi dan kode QR" : ""}.</p>
          <p><Link className={link} href={versionHref}>Buka dokumen versi {review.versionNo} untuk mengunduh</Link></p>
        </div>
      )}
      <p>{LEGAL_DISCLAIMER}</p>
    </section>
  );
}

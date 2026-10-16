import { LEGAL_DISCLAIMER, NEW_VERSION_NOT_REVIEWED, QR_NOT_SIGNATURE, verificationStatement } from "@/lib/copy";
import type { OwnerReview } from "@/lib/reviews/service";
import { LegalNoteCard } from "./legal-note-card";

const OUTCOME_TITLE: Record<string, string> = {
  WITH_NOTES: "Selesai — Dengan Legal Note",
  WITHIN_SCOPE: "Selesai — Tanpa Legal Note",
  INCONCLUSIVE: "Selesai — Belum dapat disimpulkan",
  DECLINED: "Tidak dapat diperiksa",
};

export function ResultPanel({ review, verifyUrl, qrDataUrl, isLatestVersion = true }: { review: OwnerReview; verifyUrl?: string; qrDataUrl?: string; isLatestVersion?: boolean }) {
  if (review.status !== "COMPLETED" && review.status !== "DECLINED") {
    return <p role="status" className="rounded-lg border border-slate-300 bg-white p-4">Pemeriksaan belum selesai. Hasil akan tampil di sini.</p>;
  }
  const v = review.verification;
  const badge = v && (review.outcome === "WITH_NOTES" || review.outcome === "WITHIN_SCOPE");
  return (
    <section aria-labelledby="hasil-h" className="space-y-4">
      <h2 id="hasil-h" className="text-2xl font-semibold">{OUTCOME_TITLE[review.outcome ?? ""] ?? "Selesai"}</h2>
      <p>Versi yang diperiksa: versi {review.versionNo}</p>
      {!isLatestVersion && <p role="status" className="rounded-lg border border-slate-300 bg-white p-3">{NEW_VERSION_NOT_REVIEWED}. Hasil ini hanya berlaku untuk versi {review.versionNo}.</p>}
      {review.scope && <div><h3 className="font-semibold">Ruang lingkup pemeriksaan</h3><p>{review.scope}</p></div>}
      {review.assumptions && <div><h3 className="font-semibold">Asumsi</h3><p>{review.assumptions}</p></div>}
      {review.summary && <div><h3 className="font-semibold">Ringkasan pemeriksa</h3><p>{review.summary}</p></div>}
      {review.notes.length > 0 && (
        <div className="space-y-3"><h3 className="text-xl font-semibold">Legal Note</h3>{review.notes.map((n) => <LegalNoteCard key={n.noteNo} note={n} />)}</div>
      )}
      {badge && v && (
        <div className="space-y-2 rounded-lg border border-slate-300 bg-white p-4">
          <h3 className="text-lg font-semibold">Yuktanya Legal Verified</h3>
          <p role="status" className="font-semibold">Status: {v.status === "ACTIVE" ? "Aktif" : v.status === "REVOKED" ? "Dicabut" : "Ditangguhkan sementara"}</p>
          <p>{verificationStatement("LEGAL", review.outcome)}</p>
          {verifyUrl && <p>Cek di <a className="inline-flex min-h-12 items-center underline" href={verifyUrl}>{verifyUrl}</a></p>}
          <p>Kode: <span className="font-mono break-all">{v.code}</span></p>
          {qrDataUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qrDataUrl} alt="Kode QR pengecekan verifikasi" width={140} height={140} />
          )}
          <p>{QR_NOT_SIGNATURE}</p>
        </div>
      )}
      {!badge && <p>Pemeriksaan ini tidak menghasilkan Yuktanya Legal Verified.</p>}
      <p>{LEGAL_DISCLAIMER}</p>
    </section>
  );
}

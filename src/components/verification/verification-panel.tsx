import { LEGAL_DISCLAIMER, NEW_VERSION_NOT_REVIEWED, QR_NOT_SIGNATURE, VERIFICATION_TITLES, verificationStatement } from "@/lib/copy";
import { formatDateId } from "@/lib/documents/format";
import type { VerificationView } from "@/lib/verification/service";

const STATUS: Record<VerificationView["status"], string> = { ACTIVE: "Aktif", REVOKED: "Dicabut", SUSPENDED: "Ditangguhkan sementara" };
const wibDay = (iso: string): string => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

// Sisi pemilik: verifikasi yang terikat versi ini. Versi tanpa verifikasi menampilkan pernyataan bahwa versi ini belum diperiksa.
export function VerificationPanel({ verifications, qrDataUrls, urls }: { verifications: VerificationView[]; qrDataUrls: Record<string, string>; urls: Record<string, string> }) {
  if (verifications.length === 0) {
    return <p className="rounded-lg border border-slate-300 bg-white p-3">{NEW_VERSION_NOT_REVIEWED}</p>;
  }
  return (
    <ul className="space-y-4">
      {verifications.map((v) => (
        <li key={v.id} className="space-y-2 rounded-lg border border-slate-300 bg-white p-4">
          <h3 className="text-lg font-semibold">{VERIFICATION_TITLES[v.kind]}</h3>
          <p role="status" className="font-semibold">Status: {STATUS[v.status]}</p>
          <p>{verificationStatement(v.kind, v.outcome)}</p>
          <p>Terbit {formatDateId(wibDay(v.issuedAt))}</p>
          <p>Cek di <a className="inline-flex min-h-12 items-center underline" href={urls[v.id]}>{urls[v.id]}</a></p>
          <p>Kode: <span className="font-mono break-all">{v.code}</span></p>
          {qrDataUrls[v.id] && /* eslint-disable-next-line @next/next/no-img-element */ <img src={qrDataUrls[v.id]} alt="Kode QR pengecekan verifikasi" width={140} height={140} />}
          <p>{LEGAL_DISCLAIMER}</p>
          <p>{QR_NOT_SIGNATURE}</p>
        </li>
      ))}
    </ul>
  );
}

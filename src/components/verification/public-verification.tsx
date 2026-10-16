import { formatDateId } from "@/lib/documents/format";
import { LEGAL_DISCLAIMER, QR_NOT_SIGNATURE, VERIFICATION_TITLES, verificationStatement } from "@/lib/copy";
import type { PublicVerificationResult } from "@/lib/verification/service";

const wibDay = (iso: string): string => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

export function PublicVerification({ result, code }: { result: PublicVerificationResult; code: string }) {
  if (result.status === "NOT_FOUND") {
    return (
      <main className="mx-auto max-w-2xl space-y-4 p-6">
        <h1 className="text-3xl font-semibold">Kode tidak ditemukan</h1>
        <p role="status">Kode ini tidak ada di Yuktanya. Periksa kembali kode atau pindai ulang kode QR.</p>
      </main>
    );
  }
  const title = VERIFICATION_TITLES[result.kind];
  if (result.status === "REVOKED" || result.status === "SUSPENDED") {
    const revoked = result.status === "REVOKED";
    return (
      <main className="mx-auto max-w-2xl space-y-4 p-6">
        <h1 className="text-3xl font-semibold">{revoked ? "Dicabut" : "Ditangguhkan sementara"}</h1>
        <p className="font-medium">{title}</p>
        <p role="status">
          {revoked ? "Verifikasi ini sudah dicabut. Jangan mengandalkan verifikasi ini untuk dokumen tersebut." : "Verifikasi ini sedang ditangguhkan sementara sambil diperiksa ulang. Jangan mengandalkannya dulu."}
        </p>
        <p>Kode: <span className="font-mono break-all">{code}</span></p>
        <p>{LEGAL_DISCLAIMER}</p>
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-2xl space-y-4 p-6">
      <h1 className="text-3xl font-semibold">{title}</h1>
      <p role="status" className="font-semibold">Status: Aktif</p>
      <p>{verificationStatement(result.kind, result.outcome)}</p>
      <dl className="space-y-2 rounded-lg border border-line bg-white p-4">
        <div><dt className="font-medium">Tanggal terbit</dt><dd>{formatDateId(wibDay(result.issuedAt))}</dd></div>
        <div><dt className="font-medium">Kode</dt><dd className="font-mono break-all">{code}</dd></div>
        <div><dt className="font-medium">Kode versi dokumen</dt><dd className="font-mono break-all">{result.sha256}</dd></div>
        {result.scopeSummary && <div><dt className="font-medium">Ruang lingkup</dt><dd>{result.scopeSummary}</dd></div>}
      </dl>
      <p>Cocokkan kode versi di atas dengan kode versi pada dokumen Anda. Dokumen yang diubah tidak memiliki verifikasi ini.</p>
      <p>{LEGAL_DISCLAIMER}</p>
      <p>{QR_NOT_SIGNATURE}</p>
    </main>
  );
}

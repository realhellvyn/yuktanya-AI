import { LEGAL_DISCLAIMER, QR_NOT_SIGNATURE, VERIFICATION_STATEMENTS, VERIFICATION_TITLES, VERIFIED_LABEL } from "@/lib/copy";
import type { OwnerDeep } from "@/lib/deep/service";
import { VerificationSeal } from "@/components/verification/verification-seal";

const TITLE: Record<string, string> = {
  ENHANCED_APPROVED: "Selesai: Enhanced disetujui",
  COMPLETED_WITH_NOTES: "Selesai: dengan catatan, tanpa Enhanced",
  INCONCLUSIVE: "Selesai: belum dapat disimpulkan",
  REFERRED_SPECIAL_CASE: "Dirujuk sebagai Special Legal Case",
};
const DISP: Record<string, string> = { RESOLVED: "Sudah diselesaikan", ACCEPTED_RISK: "Risiko diterima", UNRESOLVED: "Belum diselesaikan", OUT_OF_SCOPE: "Di luar ruang lingkup" };
const STATUS: Record<string, string> = { QUEUED: "Dalam antrean", IN_REVIEW: "Sedang diperiksa", READY_FOR_DECISION: "Menunggu keputusan", ON_HOLD: "Ditahan karena verifikasi Legal Review dicabut", CANCELLED: "Dibatalkan" };

export function DeepResult({ deep, verifyUrl }: { deep: OwnerDeep; verifyUrl?: string }) {
  if (deep.status !== "COMPLETED") {
    return <p role="status" className="rounded-lg border border-line bg-surface p-4">Status Deep Review: {STATUS[deep.status] ?? deep.status}.</p>;
  }
  const enhanced = deep.outcome === "ENHANCED_APPROVED" && deep.verification?.status === "ACTIVE";
  const lapsed = deep.outcome === "ENHANCED_APPROVED" && !enhanced;
  return (
    <section aria-labelledby="deep-hasil-h" className="space-y-3">
      <h2 id="deep-hasil-h" className="text-2xl font-semibold">{lapsed ? (deep.verification?.status === "REVOKED" ? "Selesai: Enhanced dicabut" : deep.verification?.status === "SUSPENDED" ? "Selesai: Enhanced ditangguhkan sementara" : "Selesai: Enhanced belum berlaku") : TITLE[deep.outcome ?? ""] ?? "Selesai"}</h2>
      {deep.extraWork && <div><h3 className="font-semibold">Pemeriksaan tambahan</h3><p>{deep.extraWork}</p></div>}
      {deep.summary && <div><h3 className="font-semibold">Ringkasan</h3><p>{deep.summary}</p></div>}
      {deep.decisionReason && <div><h3 className="font-semibold">Alasan keputusan</h3><p>{deep.decisionReason}</p></div>}
      {deep.dispositions.length > 0 && (
        <div>
          <h3 className="font-semibold">Tindak lanjut tiap catatan</h3>
          <ul className="space-y-1">{deep.dispositions.map((d) => <li key={d.noteNo}>Catatan {d.noteNo}: {DISP[d.disposition] ?? d.disposition}{d.evidence ? ` (bukti: ${d.evidence})` : ""}</li>)}</ul>
        </div>
      )}
      {enhanced && deep.verification && (
        <div className="space-y-2 rounded-lg border border-line bg-surface p-4">
          <div className="flex items-center gap-3">
            {deep.verification.status === "ACTIVE" && <VerificationSeal variant="verified" />}
            <h3 className="text-lg font-semibold">{VERIFICATION_TITLES.LEGAL_ENHANCED}</h3>
          </div>
          <p role="status" className="font-semibold">Status: {deep.verification.status === "ACTIVE" ? "Aktif" : deep.verification.status === "SUSPENDED" ? "Ditangguhkan sementara" : "Dicabut"}</p>
          <p>{VERIFICATION_STATEMENTS.LEGAL_ENHANCED}</p>
          <p className="font-semibold">{VERIFIED_LABEL}</p>
          <p>Kode: <span className="font-mono break-all">{deep.verification.code}</span></p>
          {verifyUrl && <p>Cek di <a className="inline-flex min-h-12 items-center underline" href={verifyUrl}>{verifyUrl}</a></p>}
          <p>{QR_NOT_SIGNATURE}</p>
        </div>
      )}
      {lapsed && deep.verification && (
        <div className="space-y-2 rounded-lg border border-line bg-surface p-4">
          <h3 className="text-lg font-semibold">Lencana Enhanced tidak berlaku saat ini</h3>
          <p role="status" className="font-semibold">Status: {deep.verification.status === "SUSPENDED" ? "Ditangguhkan sementara" : "Dicabut"}</p>
          <p>Keputusan sebelumnya tercatat, tetapi lencana tidak boleh dipakai sebagai bukti selama statusnya bukan Aktif.</p>
        </div>
      )}
      {!enhanced && !lapsed && <p>Deep Review ini tidak menghasilkan lencana Enhanced. Hasil Legal Review Anda tetap berlaku untuk versi yang diperiksa.</p>}
      <p>{LEGAL_DISCLAIMER}</p>
    </section>
  );
}

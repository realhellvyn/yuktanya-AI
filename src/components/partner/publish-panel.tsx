"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { fieldClass, labelText } from "@/components/ui/field";
import { standardOutcomeBlockers, type NoteLite, type StandardOutcome } from "@/lib/partner/readiness";

export type PublishNote = NoteLite & { title: string };
const OUTCOME: Record<StandardOutcome, string> = {
  WITH_NOTES: "Selesai — Dengan Legal Note",
  WITHIN_SCOPE: "Selesai — Tanpa Legal Note, sesuai lingkup",
  INCONCLUSIVE: "Belum dapat disimpulkan (tanpa verifikasi)",
  DECLINED: "Tidak dapat memeriksa (tanpa verifikasi)",
};
const SEV: Record<string, string> = { INFO: "Informasi", MINOR: "Perlu diperhatikan", MATERIAL: "Penting", CRITICAL: "Sangat penting" };

// Konfirmasi akhir Review Standar: tombol nonaktif selalu disertai alasan tertulis; jendela konfirmasi menyebut versi, hash, hasil, catatan, dan lingkup.
export function PublishPanel(props: {
  action: (fd: FormData) => Promise<void>; requestId: string; revision: number; title: string; versionNo: number; sha256: string;
  scope: string; summary: string; notes: PublishNote[]; authorized: boolean; draftMine?: boolean;
}) {
  const [outcome, setOutcome] = useState<StandardOutcome>(props.notes.length > 0 ? "WITH_NOTES" : "WITHIN_SCOPE");
  const [declared, setDeclared] = useState(false);
  const [attest, setAttest] = useState(false);
  const [noConflict, setNoConflict] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const blockers = [
    ...(props.authorized ? [] : ["Otorisasi profesional Anda tidak aktif. Hubungi koordinator."]),
    ...standardOutcomeBlockers(props, outcome),
    ...(outcome === "WITHIN_SCOPE" && !declared ? ["Centang pernyataan bahwa tidak ada catatan yang tersisa."] : []),
    ...(attest ? [] : ["Centang pernyataan profesional di bawah."]),
  ];
  const followUp = props.notes.filter((n) => n.actionable || n.severity === "MATERIAL" || n.severity === "CRITICAL");
  const verified = outcome === "WITH_NOTES" || outcome === "WITHIN_SCOPE";
  return (
    <form action={props.action} className="space-y-4">
      <input type="hidden" name="requestId" value={props.requestId} />
      <input type="hidden" name="revision" value={props.revision} />
      <dl className="grid gap-x-4 gap-y-2 rounded-xl bg-slate-50 p-4 sm:grid-cols-[auto_1fr]">
        <dt className="font-semibold">Versi</dt><dd>Versi {props.versionNo}</dd>
        <dt className="font-semibold">Sidik jari (SHA-256)</dt><dd className="break-all font-mono text-sm">{props.sha256}</dd>
        <dt className="font-semibold">Ruang lingkup</dt><dd className="break-words">{props.scope.trim() || "(belum diisi)"}</dd>
        <dt className="font-semibold">Legal Note</dt><dd>{props.notes.length} catatan, {followUp.length} perlu ditindaklanjuti pemilik</dd>
      </dl>
      <label className="block"><span className={labelText}>Hasil pemeriksaan</span>
        <select name="outcome" className={fieldClass} value={outcome} onChange={(e) => setOutcome(e.target.value as StandardOutcome)}>
          {(Object.keys(OUTCOME) as StandardOutcome[]).map((o) => <option key={o} value={o}>{OUTCOME[o]}</option>)}
        </select>
      </label>
      <label className="flex min-h-12 items-start gap-3"><input type="checkbox" name="noNotesDeclared" value="yes" checked={declared} onChange={(e) => setDeclared(e.target.checked)} className="mt-1 h-6 w-6 shrink-0" /><span>Saya menyatakan tidak ada catatan yang tersisa dan kriteria terpenuhi dalam lingkup ini.</span></label>
      <label className="flex min-h-12 items-start gap-3"><input type="checkbox" name="attest" value="yes" checked={attest} onChange={(e) => setAttest(e.target.checked)} className="mt-1 h-6 w-6 shrink-0" /><span>Saya menyatakan bahwa saya profesional yang berwenang dan telah memeriksa versi ini sendiri sesuai ruang lingkup di atas.</span></label>
      <div id="publish-blockers" role="status" aria-live="polite">
        {blockers.length > 0 && (
          <div className="rounded-xl border border-amber-400 bg-amber-50 p-4 text-amber-950">
            <p className="font-semibold">Belum bisa diterbitkan karena:</p>
            <ul className="mt-1 list-disc space-y-1 pl-6">{blockers.map((b) => <li key={b}>{b}</li>)}</ul>
          </div>
        )}
      </div>
      <Button type="button" disabled={blockers.length > 0} aria-describedby="publish-blockers" onClick={() => dialog.current?.showModal()} className="w-full sm:w-auto">Terbitkan hasil</Button>

      <dialog ref={dialog} aria-labelledby="konfirmasi-h" className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl border border-line p-0 backdrop:bg-slate-900/50">
        <div className="space-y-4 p-5">
          <h3 id="konfirmasi-h" className="text-xl font-bold text-navy">Terbitkan hasil Review Standar?</h3>
          <dl className="space-y-2">
            <div><dt className="font-semibold">Dokumen dan versi</dt><dd className="break-words">{props.title} — Versi {props.versionNo}</dd></div>
            <div><dt className="font-semibold">Sidik jari (SHA-256)</dt><dd className="break-all font-mono text-sm">{props.sha256}</dd></div>
            <div><dt className="font-semibold">Hasil</dt><dd>{OUTCOME[outcome]}</dd></div>
            <div><dt className="font-semibold">Ruang lingkup</dt><dd className="break-words">{props.scope}</dd></div>
            <div><dt className="font-semibold">Catatan yang belum diselesaikan pemilik</dt>
              <dd>{followUp.length === 0 ? "Tidak ada" : <ul className="list-disc pl-6">{followUp.map((n) => <li key={n.noteNo} className="break-words">Catatan {n.noteNo}: {n.title} ({SEV[n.severity] ?? n.severity})</li>)}</ul>}</dd></div>
          </dl>
          <p>{verified ? "Lencana Yuktanya Legal Verified hanya berlaku untuk versi ini. Versi baru tidak mewarisi hasil." : "Hasil ini tidak menerbitkan lencana verifikasi."} Setelah diterbitkan, laporan dan catatan tidak dapat diubah.</p>
          <label className="flex min-h-12 items-start gap-3"><input type="checkbox" name="noConflict" value="yes" checked={noConflict} onChange={(e) => setNoConflict(e.target.checked)} className="mt-1 h-6 w-6 shrink-0" /><span>Saya menyatakan tidak ada konflik kepentingan antara saya (dan firma saya) dengan pemilik dokumen ini atau pihak dalam dokumen ini.</span></label>
          {!noConflict && <p id="publish-conflict-hint" role="status" className="font-semibold">Centang pernyataan tidak ada konflik kepentingan untuk menerbitkan. Bila ada konflik, jangan terbitkan dan hubungi koordinator.</p>}
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button type="submit" disabled={!noConflict} aria-describedby={noConflict ? undefined : "publish-conflict-hint"}>Ya, terbitkan sekarang</Button>
            <Button type="button" variant="secondary" onClick={() => dialog.current?.close()}>Kembali memeriksa</Button>
          </div>
        </div>
      </dialog>
    </form>
  );
}

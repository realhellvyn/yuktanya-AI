"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { fieldClass, labelText } from "@/components/ui/field";

type Decision = "APPROVE" | "DENY" | "INCONCLUSIVE" | "REFER_SPECIAL";
const DECISION: Record<Decision, string> = {
  APPROVE: "Setujui Enhanced",
  DENY: "Selesai dengan catatan (tanpa Enhanced)",
  INCONCLUSIVE: "Belum dapat disimpulkan",
  REFER_SPECIAL: "Rujuk sebagai kasus khusus",
};

// Keputusan akhir Pemeriksaan Mendalam. "Setujui Enhanced" hanya aktif bila semua syarat terpenuhi; alasan yang kurang ditulis jelas.
export function DecisionPanel(props: {
  action: (fd: FormData) => Promise<void>; deepId: string; revision: number; title: string; versionNo: number; sha256: string;
  parentScope: string; approveBlockers: string[]; unresolved: string[]; authorized: boolean;
  // Berlaku untuk semua keputusan: isi buatan reviewer sebelumnya yang belum disimpan ulang (cermin decide_deep).
  confirmBlockers?: string[];
}) {
  const [decision, setDecision] = useState<Decision>("DENY");
  const [reason, setReason] = useState("");
  const [attest, setAttest] = useState(false);
  const [noConflict, setNoConflict] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const blockers = [
    ...(props.authorized ? [] : ["Otorisasi profesional Anda tidak aktif. Hubungi koordinator."]),
    ...(decision === "APPROVE" ? [] : props.confirmBlockers ?? []),
    ...(decision === "APPROVE" ? props.approveBlockers : reason.trim().length < 5 ? ["Isi alasan keputusan (minimal 5 karakter)."] : []),
    ...(attest ? [] : ["Centang pernyataan profesional di bawah."]),
  ];
  return (
    <form action={props.action} className="space-y-4">
      <input type="hidden" name="deepId" value={props.deepId} /><input type="hidden" name="revision" value={props.revision} />
      <dl className="grid gap-x-4 gap-y-2 rounded-xl bg-slate-50 p-4 sm:grid-cols-[auto_1fr]">
        <dt className="font-semibold">Versi</dt><dd>Versi {props.versionNo}</dd>
        <dt className="font-semibold">Sidik jari (SHA-256)</dt><dd className="break-all font-mono text-sm">{props.sha256}</dd>
        <dt className="font-semibold">Ruang lingkup standar</dt><dd className="break-words">{props.parentScope || "(tidak tercatat)"}</dd>
      </dl>
      <label className="block"><span className={labelText}>Keputusan</span>
        <select name="decision" className={fieldClass} value={decision} onChange={(e) => setDecision(e.target.value as Decision)}>
          {(Object.keys(DECISION) as Decision[]).map((d) => <option key={d} value={d}>{DECISION[d]}</option>)}
        </select>
      </label>
      <label className="block"><span className={labelText}>Alasan (wajib selain Setujui)</span><textarea name="reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} className={fieldClass} /></label>
      <label className="flex min-h-12 items-start gap-3"><input type="checkbox" name="attest" value="yes" checked={attest} onChange={(e) => setAttest(e.target.checked)} className="mt-1 h-6 w-6 shrink-0" /><span>Saya menyatakan bahwa saya profesional yang berwenang dan telah melakukan pemeriksaan tambahan ini sendiri.</span></label>
      <div id="decision-blockers" role="status" aria-live="polite">
        {blockers.length > 0 && (
          <div className="rounded-xl border border-amber-400 bg-amber-50 p-4 text-amber-950">
            <p className="font-semibold">{decision === "APPROVE" ? "Enhanced belum dapat disetujui karena:" : "Keputusan belum dapat disimpan karena:"}</p>
            <ul className="mt-1 list-disc space-y-1 pl-6">{blockers.map((b) => <li key={b}>{b}</li>)}</ul>
          </div>
        )}
      </div>
      <Button type="button" disabled={blockers.length > 0} aria-describedby="decision-blockers" onClick={() => dialog.current?.showModal()} className="w-full sm:w-auto">Simpan keputusan</Button>

      <dialog ref={dialog} aria-labelledby="keputusan-konfirmasi-h" className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl border border-line p-0 backdrop:bg-slate-900/50">
        <div className="space-y-4 p-5">
          <h3 id="keputusan-konfirmasi-h" className="text-xl font-bold text-navy">Simpan keputusan Pemeriksaan Mendalam?</h3>
          <dl className="space-y-2">
            <div><dt className="font-semibold">Dokumen dan versi</dt><dd className="break-words">{props.title} — Versi {props.versionNo}</dd></div>
            <div><dt className="font-semibold">Sidik jari (SHA-256)</dt><dd className="break-all font-mono text-sm">{props.sha256}</dd></div>
            <div><dt className="font-semibold">Keputusan</dt><dd>{DECISION[decision]}</dd></div>
            <div><dt className="font-semibold">Ruang lingkup</dt><dd className="break-words">{props.parentScope || "(tidak tercatat)"} (pemeriksaan tambahan)</dd></div>
            <div><dt className="font-semibold">Catatan yang belum diselesaikan</dt>
              <dd>{props.unresolved.length === 0 ? "Tidak ada" : <ul className="list-disc pl-6">{props.unresolved.map((u) => <li key={u} className="break-words">{u}</li>)}</ul>}</dd></div>
          </dl>
          <p>Pembayaran tidak menjamin hasil apa pun. Keputusan tidak dapat diubah setelah disimpan.</p>
          <label className="flex min-h-12 items-start gap-3"><input type="checkbox" name="noConflict" value="yes" checked={noConflict} onChange={(e) => setNoConflict(e.target.checked)} className="mt-1 h-6 w-6 shrink-0" /><span>Saya menyatakan tidak ada konflik kepentingan antara saya (dan firma saya) dengan pemilik dokumen ini atau pihak dalam dokumen ini.</span></label>
          {!noConflict && <p id="decision-conflict-hint" role="status" className="font-semibold">Centang pernyataan tidak ada konflik kepentingan untuk menyimpan keputusan. Bila ada konflik, jangan simpan dan hubungi koordinator.</p>}
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button type="submit" disabled={!noConflict} aria-describedby={noConflict ? undefined : "decision-conflict-hint"}>Ya, simpan keputusan</Button>
            <Button type="button" variant="secondary" onClick={() => dialog.current?.close()}>Kembali memeriksa</Button>
          </div>
        </div>
      </dialog>
    </form>
  );
}

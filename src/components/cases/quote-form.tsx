"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { fieldClass, labelText } from "@/components/ui/field";
import type { QuoteState } from "@/app/(partner)/partner/cases/actions";

// Penawaran khusus koordinator: biaya, ruang lingkup, tanggal berlaku. Isian tetap ada bila gagal.
export function QuoteForm({ action, caseId, minDate, maxDate, isRevision }: {
  action: (prev: QuoteState, formData: FormData) => Promise<QuoteState>;
  caseId: string;
  minDate: string;
  maxDate: string;
  isRevision: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="caseId" value={caseId} />
      <label className="block">
        <span className={labelText}>Biaya (rupiah)</span>
        <input name="amount" inputMode="numeric" required placeholder="contoh: 2.500.000" defaultValue={state.values?.amount ?? ""} className={fieldClass} />
      </label>
      <label className="block">
        <span className={labelText}>Ruang lingkup pekerjaan</span>
        <textarea name="scope" required minLength={10} maxLength={2000} rows={4} defaultValue={state.values?.scope ?? ""} className={fieldClass} />
      </label>
      <label className="block">
        <span className={labelText}>Penawaran berlaku sampai</span>
        <input type="date" name="expiresOn" required min={minDate} max={maxDate} defaultValue={state.values?.expiresOn ?? ""} className={fieldClass} />
      </label>
      <p className="text-muted">Pemilik menerima atau menolak secara eksplisit. Penerimaan tidak membuat tagihan otomatis dan bukan persetujuan atas dokumen.</p>
      {state.error && <p role="alert" className="rounded-xl border border-danger bg-red-50 p-4 font-semibold text-danger">{state.error}</p>}
      <Button type="submit" disabled={pending}>{pending ? "Mengirim…" : isRevision ? "Kirim penawaran baru" : "Kirim penawaran"}</Button>
    </form>
  );
}

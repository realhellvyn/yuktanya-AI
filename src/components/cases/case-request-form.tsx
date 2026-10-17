"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { fieldClass, labelText } from "@/components/ui/field";
import type { SubmitCaseState } from "@/app/(app)/cases/actions";

// Formulir pengajuan Special Legal Case. Bila gagal, isian tetap ada dan alasan ditampilkan dengan bahasa yang jelas.
export function CaseRequestForm({ action, documentId, idempotencyKey }: {
  action: (prev: SubmitCaseState, formData: FormData) => Promise<SubmitCaseState>;
  documentId: string | null;
  idempotencyKey: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="documentId" value={documentId ?? ""} />
      <input type="hidden" name="key" value={idempotencyKey} />
      <label className="block">
        <span className={labelText}>Ceritakan singkat kebutuhan Anda</span>
        <span className="block text-muted">Contoh: jenis perjanjian, pihak yang terlibat (tanpa nomor identitas), dan hal yang Anda khawatirkan. Minimal 20 karakter.</span>
        <textarea name="summary" required minLength={20} maxLength={2000} rows={6} defaultValue={state.values?.summary ?? ""} className={fieldClass} />
      </label>
      <label className="flex min-h-12 items-start gap-3">
        <input type="checkbox" name="consent" value="yes" required defaultChecked={state.values?.consent ?? false} className="mt-1 h-6 w-6 shrink-0" />
        <span>Saya setuju ringkasan ini{documentId ? " dan informasi jenis dokumen" : ""} dibagikan kepada firma hukum mitra Yuktanya untuk penilaian awal, termasuk pemeriksaan konflik kepentingan.</span>
      </label>
      {state.error && <p role="alert" className="rounded-xl border border-danger bg-red-50 p-4 font-semibold text-danger">{state.error}</p>}
      <Button type="submit" disabled={pending}>{pending ? "Mengirim…" : "Kirim pengajuan"}</Button>
    </form>
  );
}

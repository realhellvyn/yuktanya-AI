"use client";

import { useActionState } from "react";

export type CreateShareState = { link?: string; error?: string };

export function CreateShareForm({
  action,
  versionId,
  documentId,
}: {
  action: (prev: CreateShareState, formData: FormData) => Promise<CreateShareState>;
  versionId: string;
  documentId: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="versionId" value={versionId} />
      <input type="hidden" name="documentId" value={documentId} />
      <label className="block">
        <span className="font-medium">Tautan berlaku selama</span>
        <select name="days" defaultValue="7" className="mt-1 block min-h-12 w-full rounded-lg border border-slate-400 px-3">
          <option value="1">1 hari</option>
          <option value="7">7 hari</option>
          <option value="30">30 hari</option>
        </select>
      </label>
      <button type="submit" disabled={pending} className="min-h-12 rounded-lg bg-brand hover:bg-brand-dark px-5 font-semibold text-white">Buat tautan berbagi</button>
      {state.error && <p role="alert" className="font-semibold text-danger">{state.error}</p>}
      {state.link && (
        <p role="status" className="break-all rounded-lg border border-line bg-white p-3">
          Salin tautan ini dan kirim ke pihak lawan. Tautan hanya ditampilkan sekali: <strong>{state.link}</strong>
        </p>
      )}
    </form>
  );
}

"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { labelText } from "@/components/ui/field";
import type { UploadState } from "@/app/(app)/documents/upload/actions";
import { AI_REVIEW_CONSENT } from "@/lib/copy";
import { MAX_UPLOAD_BYTES } from "@/lib/uploads/limits";
import { UPLOAD_MESSAGES } from "@/lib/uploads/messages";

// Kode penolakan yang lebih cocok diarahkan ke Kasus Hukum Khusus daripada dicoba ulang.
const SPECIAL = new Set(["SCANNED_PDF", "TOO_LONG", "TOO_MANY_PAGES", "PARSE_FAILED", "ENCRYPTED", "UNSUPPORTED_TYPE"]);

// Fix round 1 (I1): berkas di atas batas ditolak di perangkat sebelum dikirim. Tanpa ini, berkas di atas ±4,5 MB ditolak
// platform (413) dengan halaman galat umum. Pemeriksaan di server tetap berlaku.
export const fileTooLarge = (size: number | undefined): boolean => size !== undefined && size > MAX_UPLOAD_BYTES;

export function UploadForm({ action, idempotencyKey }: {
  action: (prev: UploadState, formData: FormData) => Promise<UploadState>;
  idempotencyKey: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [tooLarge, setTooLarge] = useState(false);
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (tooLarge) e.preventDefault();
      }}
      className="space-y-5"
    >
      <input type="hidden" name="key" value={idempotencyKey} />
      <label className="block space-y-1">
        <span className={labelText}>Pilih berkas (PDF, Word/DOCX, atau TXT)</span>
        <input
          type="file"
          name="file"
          required
          accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
          aria-describedby={tooLarge ? "berkas-terlalu-besar" : undefined}
          onChange={(e) => setTooLarge(fileTooLarge(e.currentTarget.files?.[0]?.size))}
          className="block min-h-12 w-full max-w-full rounded-xl border border-border-strong bg-surface px-3 py-2 text-base file:mr-3 file:min-h-10 file:rounded-lg file:border-0 file:bg-subtle file:px-4 file:font-semibold"
        />
      </label>
      {tooLarge && (
        <div id="berkas-terlalu-besar" role="alert" className="space-y-2 rounded-xl border border-danger bg-red-50 p-4 text-danger">
          <p className="font-semibold">{UPLOAD_MESSAGES.TOO_LARGE}</p>
          <p>Pilih berkas lain yang lebih kecil. Berkas ini belum dikirim.</p>
        </div>
      )}
      <label className="flex min-h-12 items-start gap-3">
        <input type="checkbox" name="consent" value="yes" required defaultChecked={state.consent ?? false} className="mt-1 h-6 w-6 shrink-0" />
        <span>{AI_REVIEW_CONSENT}</span>
      </label>
      {state.error && (
        <div role="alert" className="space-y-2 rounded-xl border border-danger bg-red-50 p-4 text-danger">
          <p className="font-semibold">{state.error}</p>
          {state.code !== "NO_CONSENT" && state.code !== "FEATURE_DISABLED" && <p>Pilih berkas kembali sebelum mencoba lagi.</p>}
          {state.code && SPECIAL.has(state.code) && (
            <Link href="/cases/new" className="inline-flex min-h-12 items-center font-semibold text-link underline underline-offset-4">Ajukan Special Legal Case</Link>
          )}
        </div>
      )}
      <Button type="submit" disabled={pending || tooLarge}>{pending ? "Membaca dan menganalisis…" : "Mulai analisis awal"}</Button>
      {pending && <p role="status" className="text-muted">Mohon tunggu. Proses ini dapat berlangsung hingga satu menit.</p>}
    </form>
  );
}

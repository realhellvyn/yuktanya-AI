"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { SlowProgress } from "@/components/documents/slow-progress";

// Fix round 1 (M6): formulir analisis awal AI di halaman dokumen. Selama aksi berjalan tombol nonaktif (tidak ada kiriman
// ganda), dan setelah ±10 detik teks progres tenang dibacakan (aria-live polite).
function SubmitButton({ again }: { again: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" disabled={pending} aria-disabled={pending}>
      {pending ? "AI sedang menganalisis…" : again ? "Ulangi analisis awal AI" : "Mulai analisis awal AI"}
    </Button>
  );
}

export function AiReviewForm({ action, versionId, documentId, consentText, again }: {
  action: (formData: FormData) => Promise<void>;
  versionId: string;
  documentId: string;
  consentText: string;
  again: boolean;
}) {
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="versionId" value={versionId} />
      <input type="hidden" name="documentId" value={documentId} />
      <label className="flex min-h-12 items-start gap-3">
        <input type="checkbox" name="consent" value="yes" required className="mt-1 h-6 w-6 shrink-0" />
        <span>{consentText}</span>
      </label>
      <SubmitButton again={again} />
      <SlowProgress />
    </form>
  );
}

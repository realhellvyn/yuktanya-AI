import { AI_DRAFT_LABEL } from "@/lib/copy";

export function AssistBox({ documentId, action }: { documentId: string; action: (formData: FormData) => Promise<void> }) {
  return (
    <details className="rounded-lg border border-slate-300 bg-white p-4">
      <summary className="inline-flex min-h-12 cursor-pointer items-center font-medium">Isi otomatis dari cerita Anda (AI, opsional)</summary>
      <form action={action} className="mt-3 space-y-3">
        <input type="hidden" name="documentId" value={documentId} />
        <label className="block">
          <span className="font-medium">Ceritakan singkat isi dokumen yang Anda inginkan (minimal 20 karakter)</span>
          <textarea name="story" rows={5} minLength={20} maxLength={4000} required className="mt-1 block w-full rounded-lg border border-slate-400 px-3 py-2" />
        </label>
        <p>AI hanya mengisi kolom kosong dengan hal yang tertulis di cerita Anda. {AI_DRAFT_LABEL} Periksa setiap jawaban.</p>
        <button type="submit" className="min-h-12 rounded-lg border border-slate-400 bg-white px-5 font-medium">Isi dengan AI</button>
      </form>
    </details>
  );
}

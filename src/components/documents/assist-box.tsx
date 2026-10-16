import { AI_DRAFT_LABEL } from "@/lib/copy";

export function AssistBox({ documentId, action }: { documentId: string; action: (formData: FormData) => Promise<void> }) {
  return (
    <details className="group rounded-2xl border border-line bg-white p-4">
      <summary className="inline-flex min-h-12 cursor-pointer items-center font-semibold text-brand-dark">Lebih mudah bercerita? Isi otomatis dengan AI (opsional)</summary>
      <form action={action} className="mt-3 space-y-3">
        <input type="hidden" name="documentId" value={documentId} />
        <label className="block">
          <span className="font-medium">Ceritakan singkat isi dokumen yang Anda inginkan (minimal 20 karakter)</span>
          <textarea name="story" rows={5} minLength={20} maxLength={4000} required className="mt-1 block w-full rounded-xl border border-slate-400 px-3 py-2" />
        </label>
        <p className="text-muted">AI hanya mengisi kolom kosong dengan hal yang tertulis di cerita Anda. {AI_DRAFT_LABEL} Periksa setiap jawaban.</p>
        <button type="submit" className="min-h-12 rounded-xl border border-slate-400 bg-white px-5 font-semibold hover:bg-slate-50">Isi dengan AI</button>
      </form>
    </details>
  );
}

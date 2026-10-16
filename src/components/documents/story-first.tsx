import { AI_DRAFT_LABEL } from "@/lib/copy";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

// Pintu masuk utama: pengguna bercerita, AI mengisi kolom yang tertulis di cerita itu. Pengguna selalu memeriksa hasilnya dulu.
export function StoryFirst({ documentId, action, manualHref, example }: { documentId: string; action: (formData: FormData) => Promise<void>; manualHref: string; example: string }) {
  return (
    <Card className="space-y-4">
      <form action={action} className="space-y-4">
        <input type="hidden" name="documentId" value={documentId} />
        <label className="block">
          <span className="text-xl font-bold leading-snug text-navy">Ceritakan singkat dokumen yang Anda butuhkan</span>
          <span className="mt-1 block text-muted">Contoh: {example} (Minimal 20 karakter)</span>
          <textarea name="story" rows={6} minLength={20} maxLength={4000} required className="mt-3 block w-full rounded-xl border border-slate-400 bg-white px-4 py-3 text-lg" />
        </label>
        <p className="text-sm text-muted">AI hanya mengisi kolom dengan hal yang tertulis di cerita Anda; tidak mengarang nama, jumlah, atau tanggal. Anda memeriksa semua jawaban sebelum dokumen dibuat. {AI_DRAFT_LABEL}</p>
        <Button type="submit" className="w-full">Isi dengan AI</Button>
      </form>
      <div className="flex items-center gap-3 text-muted" aria-hidden="true"><span className="h-px flex-1 bg-line" />atau<span className="h-px flex-1 bg-line" /></div>
      <ButtonLink href={manualHref} variant="secondary" className="w-full">Isi manual satu per satu</ButtonLink>
    </Card>
  );
}

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, PageHeading } from "@/components/ui/card";
import { DOC_OPTIONS } from "@/lib/documents/options";
import { fixedText } from "@/lib/query-text";
import { createDocumentAction } from "../../documents/actions";

// Halaman memakai sesi dan DB: tidak boleh diprarender saat build.
export const dynamic = "force-dynamic";
export const metadata = { title: "Buat Dokumen | Yuktanya" };

// Kode galat dari aksi pembuatan dokumen → kalimat tetap. Teks dari alamat tidak pernah ditampilkan apa adanya (D-05).
const ERRORS = {
  template: "Jenis dokumen ini belum tersedia. Pilih jenis dokumen lain.",
  "too-many-drafts": "Jumlah draf yang belum selesai sudah mencapai batas. Selesaikan atau lanjutkan salah satu draf lebih dulu.",
};

export default async function NewWorkspacePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const error = fixedText(ERRORS, (await searchParams).error);
  return (
    <main className="max-w-5xl space-y-6">
      <PageHeading title="Pilih jenis dokumen" lead="AI akan menanyakan detail dokumen satu per satu. Setiap jawaban tersimpan otomatis." />
      {error && <p role="alert" className="rounded-xl border border-danger bg-surface p-4 font-semibold text-danger">{error}</p>}
      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {DOC_OPTIONS.map((o) => (
          <li key={o.category}>
            <Card className="h-full">
              <form action={createDocumentAction} className="flex h-full flex-col gap-3">
                <input type="hidden" name="category" value={o.category} />
                <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-tint text-navy">
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={o.icon} /></svg>
                </span>
                <h2 className="text-lg font-bold text-navy">{o.title}</h2>
                <p className="flex-1 text-muted">{o.text}</p>
                <Button type="submit" className="w-full">Mulai<span className="sr-only"> {o.title}</span></Button>
              </form>
            </Card>
          </li>
        ))}
        <li>
          <Card className="flex h-full flex-col gap-3 border-dashed">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-tint text-navy">
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 9a3 3 0 1 1 4 2.8c-.6.3-1 .9-1 1.6V15M12 18h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18" /></svg>
            </span>
            <h2 className="text-lg font-bold text-navy">Saya belum tahu</h2>
            <p className="flex-1 text-muted">Ceritakan keperluan Anda. AI akan menyarankan salah satu jenis dokumen yang tersedia.</p>
            <Link href="/workspace/pilih" className="inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-border-strong bg-surface px-5 text-lg font-semibold text-navy hover:bg-subtle">
              Bantu saya memilih
            </Link>
          </Card>
        </li>
      </ul>
    </main>
  );
}

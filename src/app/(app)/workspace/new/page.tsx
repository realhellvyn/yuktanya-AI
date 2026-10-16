import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, PageHeading } from "@/components/ui/card";
import { fixedText } from "@/lib/query-text";
import { createDocumentAction } from "../../documents/actions";

// Halaman memakai sesi dan DB: tidak boleh diprarender saat build.
export const dynamic = "force-dynamic";
export const metadata = { title: "Buat Dokumen | Yuktanya" };

const OPTIONS = [
  { category: "PKS", title: "Perjanjian Kerja Sama", text: "untuk kerja sama usaha atau proyek", icon: "M8 12l3 3 5-6M4 6h16v12H4z" },
  { category: "UTANG_PIUTANG", title: "Surat Utang Piutang", text: "untuk pinjam-meminjam uang", icon: "M12 3v18M16 7H10a3 3 0 0 0 0 6h4a3 3 0 0 1 0 6H8" },
  { category: "NDA", title: "Perjanjian Kerahasiaan (NDA)", text: "untuk menjaga informasi rahasia", icon: "M5 10V7a7 7 0 0 1 14 0v3M4 10h16v11H4z" },
];
// Kode galat dari aksi pembuatan dokumen → kalimat tetap. Teks dari alamat tidak pernah ditampilkan apa adanya (D-05).
const ERRORS = {
  template: "Dokumen ini belum tersedia.",
  "too-many-drafts": "Anda punya terlalu banyak draf yang belum selesai. Selesaikan salah satunya dulu.",
};

export default async function NewWorkspacePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const error = fixedText(ERRORS, (await searchParams).error);
  return (
    <main className="max-w-5xl space-y-6">
      <PageHeading title="Dokumen apa yang ingin Anda buat?" lead="Pilih satu. Anda akan bercakap dengan AI yang menanyakan isi dokumen satu per satu. Setiap pesan tersimpan otomatis." />
      {error && <p role="alert" className="rounded-xl border border-danger bg-white p-4 font-semibold text-danger">{error}</p>}
      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {OPTIONS.map((o) => (
          <li key={o.category}>
            <Card className="h-full">
              <form action={createDocumentAction} className="flex h-full flex-col gap-3">
                <input type="hidden" name="category" value={o.category} />
                <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-brand-dark">
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
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-brand-dark">
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 9a3 3 0 1 1 4 2.8c-.6.3-1 .9-1 1.6V15M12 18h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18" /></svg>
            </span>
            <h2 className="text-lg font-bold text-navy">Saya belum tahu</h2>
            <p className="flex-1 text-muted">Ceritakan keperluan Anda. AI membantu memilih salah satu dari tiga dokumen di atas.</p>
            <Link href="/workspace/pilih" className="inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-slate-400 bg-white px-5 text-lg font-semibold text-navy hover:bg-slate-50">
              Bantu saya memilih
            </Link>
          </Card>
        </li>
      </ul>
    </main>
  );
}

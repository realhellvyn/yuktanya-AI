import { Button } from "@/components/ui/button";
import { Card, PageHeading } from "@/components/ui/card";
import { createDocumentAction } from "../../documents/actions";

// Halaman memakai sesi dan DB: tidak boleh diprarender saat build.
export const dynamic = "force-dynamic";

const OPTIONS = [
  { category: "PKS", title: "Perjanjian Kerja Sama", text: "untuk kerja sama usaha atau proyek", icon: "M8 12l3 3 5-6M4 6h16v12H4z" },
  { category: "UTANG_PIUTANG", title: "Surat Utang Piutang", text: "untuk pinjam-meminjam uang", icon: "M12 3v18M16 7H10a3 3 0 0 0 0 6h4a3 3 0 0 1 0 6H8" },
  { category: "NDA", title: "Perjanjian Kerahasiaan (NDA)", text: "untuk menjaga informasi rahasia", icon: "M5 10V7a7 7 0 0 1 14 0v3M4 10h16v11H4z" },
];

export default async function NewWorkspacePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="max-w-4xl space-y-6">
      <PageHeading title="Dokumen apa yang ingin Anda buat?" lead="Pilih satu. Anda akan menjawab beberapa pertanyaan singkat, satu per satu. Jawaban tersimpan setiap kali Anda menekan Lanjut." />
      {error && <p role="alert" className="rounded-xl border border-danger bg-white p-4 font-semibold text-danger">{error}</p>}
      <ul className="grid gap-4 md:grid-cols-3">
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
                <Button type="submit" className="w-full">Mulai</Button>
              </form>
            </Card>
          </li>
        ))}
      </ul>
    </main>
  );
}

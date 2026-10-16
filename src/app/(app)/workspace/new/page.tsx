import { createDocumentAction } from "../../documents/actions";

const OPTIONS = [
  { category: "PKS", title: "Perjanjian Kerja Sama", text: "untuk kerja sama usaha atau proyek" },
  { category: "UTANG_PIUTANG", title: "Surat Utang Piutang", text: "untuk pinjam-meminjam uang" },
  { category: "NDA", title: "Perjanjian Kerahasiaan (NDA)", text: "untuk menjaga informasi rahasia" },
];

export default async function NewWorkspacePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-3xl font-semibold">Dokumen apa yang ingin Anda buat?</h1>
      {error && <p role="alert" className="rounded-lg border border-red-700 bg-white p-4 text-red-800">{error}</p>}
      <ul className="grid gap-4 md:grid-cols-3">
        {OPTIONS.map((o) => (
          <li key={o.category} className="rounded-lg border border-slate-300 bg-white p-4">
            <form action={createDocumentAction} className="space-y-3">
              <input type="hidden" name="category" value={o.category} />
              <h2 className="text-lg font-semibold">{o.title}</h2>
              <p>{o.text}</p>
              <button type="submit" className="min-h-12 w-full rounded-lg bg-blue-600 px-4 font-semibold text-white">Mulai</button>
            </form>
          </li>
        ))}
      </ul>
      <p>Anda akan menjawab beberapa pertanyaan singkat, satu per satu. Jawaban tersimpan setiap kali Anda menekan Lanjut.</p>
    </main>
  );
}

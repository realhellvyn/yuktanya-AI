import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { AI_DRAFT_LABEL, SLOGAN } from "@/lib/copy";

const DOCS = [
  { title: "Perjanjian Kerja Sama", text: "Untuk kerja sama usaha atau proyek." },
  { title: "Surat Utang Piutang", text: "Untuk pinjam-meminjam uang." },
  { title: "Perjanjian Kerahasiaan (NDA)", text: "Untuk menjaga informasi rahasia." },
];

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-5xl space-y-10 p-6">
        <section>
          <h1 className="text-3xl font-semibold md:text-4xl">Buat dokumen hukum lebih mudah</h1>
          <p className="mt-2 text-lg">{SLOGAN}</p>
          <p className="mt-4 max-w-2xl">
            Jawab beberapa pertanyaan sederhana, lalu dapatkan draf dokumen. Pemeriksaan oleh pengacara bersifat pilihan dan
            berbayar.
          </p>
          <Link href="/register" className="mt-6 inline-flex min-h-12 items-center rounded-lg bg-blue-600 px-6 font-semibold text-white">
            Daftar Gratis
          </Link>
        </section>
        <section aria-labelledby="docs">
          <h2 id="docs" className="text-2xl font-semibold">Dokumen yang bisa dibuat</h2>
          <ul className="mt-4 grid gap-4 md:grid-cols-3">
            {DOCS.map((d) => (
              <li key={d.title} className="rounded-lg border border-slate-300 bg-white p-4">
                <h3 className="font-semibold">{d.title}</h3>
                <p>{d.text}</p>
              </li>
            ))}
          </ul>
        </section>
        <p className="rounded-lg border border-slate-300 bg-white p-4">{AI_DRAFT_LABEL} AI bukan pengacara.</p>
      </main>
    </>
  );
}

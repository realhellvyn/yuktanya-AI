import { AI_DRAFT_LABEL } from "@/lib/copy";

const OPTIONS = [
  { title: "Perjanjian Kerja Sama", text: "untuk kerja sama usaha/proyek" },
  { title: "Surat Utang Piutang", text: "untuk pinjam-meminjam uang" },
  { title: "Perjanjian Kerahasiaan (NDA)", text: "untuk menjaga informasi rahasia" },
];

export default function DashboardPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-3xl font-semibold">Selamat datang di Yuktanya</h1>
      <p className="text-xl">Apa yang ingin Anda buat hari ini?</p>
      <p className="rounded-lg border border-slate-300 bg-white p-4">
        Buat dokumen baru (Gratis) akan tersedia pada tahap berikutnya. {AI_DRAFT_LABEL}
      </p>
      <ul className="grid gap-4 md:grid-cols-3">
        {OPTIONS.map((o) => (
          <li key={o.title} className="rounded-lg border border-slate-300 bg-white p-4">
            <h2 className="font-semibold">{o.title}</h2>
            <p>{o.text}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}

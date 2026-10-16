import { RangeNav } from "@/components/admin/range-nav";
import { fmtCount } from "@/lib/admin/format";
import { loadOverview } from "@/lib/admin/page-data";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ r?: string }> }) {
  const { o, range } = await loadOverview(await searchParams);
  const f = o.funnel;
  const rows: [string, number][] = [
    ["Terdaftar", f.registered], ["Pernah memakai AI", f.ai_used], ["Memulai dokumen", f.doc_started], ["Membuat versi dokumen", f.version_created],
    ["Meminta review", f.review_requested], ["Review dibayar", f.review_paid], ["Review selesai", f.review_completed],
  ];
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-3xl font-semibold">Funnel</h1>
      <RangeNav path="/admin/analytics" range={range} />
      <p>Kohort tetap: pengguna yang mendaftar pada rentang ini ({fmtCount(f.registered)} orang). Setiap langkah menghitung pengguna unik dari kohort itu, kapan pun langkah itu terjadi. Persentase memakai kohort sebagai penyebut.</p>
      <table className="w-full border-collapse">
        <caption className="sr-only">Funnel kohort pendaftar</caption>
        <thead><tr><th scope="col" className="border p-2 text-left">Langkah</th><th scope="col" className="border p-2 text-right">Pengguna</th><th scope="col" className="border p-2 text-right">% kohort</th></tr></thead>
        <tbody>{rows.map(([label, n]) => <tr key={label}><th scope="row" className="border p-2 text-left font-normal">{label}</th><td className="border p-2 text-right">{fmtCount(n)}</td><td className="border p-2 text-right">{f.registered > 0 ? `${Math.round((n / f.registered) * 100)}%` : "Belum ada data"}</td></tr>)}</tbody>
      </table>
    </main>
  );
}

import { PageHeading } from "@/components/ui/card";
import { RangeNav } from "@/components/admin/range-nav";
import { fmtCount } from "@/lib/admin/format";
import { loadOverview } from "@/lib/admin/page-data";

export const dynamic = "force-dynamic";
export const metadata = { title: "Funnel | Admin Yuktanya" };

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ r?: string }> }) {
  const { o, range } = await loadOverview(await searchParams);
  const f = o.funnel;
  const rows: [string, number][] = [
    ["Terdaftar", f.registered], ["Pernah memakai AI", f.ai_used], ["Memulai dokumen", f.doc_started], ["Membuat versi dokumen", f.version_created],
    ["Meminta review", f.review_requested], ["Review dibayar", f.review_paid], ["Review selesai", f.review_completed],
  ];
  return (
    <main className="max-w-5xl space-y-6">
      <PageHeading title="Funnel" />
      <RangeNav path="/admin/analytics" range={range} />
      <p>Kohort tetap: pengguna yang mendaftar pada rentang ini ({fmtCount(f.registered)} orang). Setiap langkah menghitung pengguna unik dari kohort itu, kapan pun langkah itu terjadi. Persentase memakai kohort sebagai penyebut.</p>
      <div className="overflow-x-auto rounded-2xl border border-line bg-white"><table className="w-full border-collapse">
        <caption className="sr-only">Funnel kohort pendaftar</caption>
        <thead><tr><th scope="col" className="border-b border-line p-3 text-left">Langkah</th><th scope="col" className="border-b border-line p-3 text-right">Pengguna</th><th scope="col" className="border-b border-line p-3 text-right">% kohort</th></tr></thead>
        <tbody>{rows.map(([label, n]) => <tr key={label}><th scope="row" className="border-b border-line p-3 text-left font-normal">{label}</th><td className="border-b border-line p-3 text-right">{fmtCount(n)}</td><td className="border-b border-line p-3 text-right">{f.registered > 0 ? `${Math.round((n / f.registered) * 100)}%` : "Belum ada data"}</td></tr>)}</tbody>
      </table></div>
    </main>
  );
}

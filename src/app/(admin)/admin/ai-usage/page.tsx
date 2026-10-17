import { PageHeading } from "@/components/ui/card";
import { KpiCard } from "@/components/admin/kpi-card";
import { RangeNav } from "@/components/admin/range-nav";
import { fmtCount, fmtMs, fmtPercent } from "@/lib/admin/format";
import { loadOverview } from "@/lib/admin/page-data";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pemakaian AI | Admin Yuktanya" };

export default async function AiUsagePage({ searchParams }: { searchParams: Promise<{ r?: string }> }) {
  const { o, range } = await loadOverview(await searchParams);
  return (
    <main className="max-w-5xl space-y-6">
      <PageHeading title="Pemakaian AI" />
      <RangeNav path="/admin/ai-usage" range={range} />
      {o.ai === null && <p role="status">Belum ada data pemakaian AI yang tercatat.</p>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard label="Permintaan" value={fmtCount(o.ai?.requests)} />
        <KpiCard label="Tingkat keberhasilan" value={fmtPercent(o.ai?.success_rate)} hint="Berhasil / selesai" />
        <KpiCard label="Gagal" value={fmtCount(o.ai?.failed)} />
        <KpiCard label="Latensi P50" value={fmtMs(o.ai?.p50_ms)} />
        <KpiCard label="Latensi P95" value={fmtMs(o.ai?.p95_ms)} />
      </div>
      <p>Hanya angka dan status yang dicatat. Isi pesan dan dokumen pengguna tidak disimpan dalam data pemakaian ini.</p>
    </main>
  );
}

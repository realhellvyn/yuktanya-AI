import Link from "next/link";
import { KpiCard } from "@/components/admin/kpi-card";
import { RangeNav } from "@/components/admin/range-nav";
import { fmtCount, fmtHours } from "@/lib/admin/format";
import { loadOverview } from "@/lib/admin/page-data";

export const dynamic = "force-dynamic";

export default async function ReviewsOpsPage({ searchParams }: { searchParams: Promise<{ r?: string }> }) {
  const { o, range } = await loadOverview(await searchParams);
  const b = o.reviews.backlog_by_age;
  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <h1 className="text-3xl font-semibold">Operasi review</h1>
      <RangeNav path="/admin/reviews" range={range} />
      <div className="grid gap-4 md:grid-cols-3">
        <KpiCard label="Belum ditugaskan" value={fmtCount(o.reviews.unassigned)} hint="Rutekan di Perutean review" />
        <KpiCard label="Antrean < 24 jam" value={fmtCount(b.lt_24h)} />
        <KpiCard label="Antrean 1–3 hari" value={fmtCount(b.d1_3)} />
        <KpiCard label="Antrean > 3 hari" value={fmtCount(b.gt_3d)} />
        <KpiCard label="Review selesai" value={fmtCount(o.reviews.completed)} />
        <KpiCard label="Waktu selesai (median)" value={fmtHours(o.reviews.sla_median_hours)} hint="Dari pembayaran terverifikasi ke selesai. Target SLA belum ditetapkan." />
        <KpiCard label="Waktu selesai (P95)" value={fmtHours(o.reviews.sla_p95_hours)} />
      </div>
      <Link className="inline-flex min-h-12 items-center underline" href="/admin/routing">Buka perutean review</Link>
    </main>
  );
}

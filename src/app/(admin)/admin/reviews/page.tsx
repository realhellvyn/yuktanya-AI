import { PageHeading } from "@/components/ui/card";
import Link from "next/link";
import { KpiCard } from "@/components/admin/kpi-card";
import { RangeNav } from "@/components/admin/range-nav";
import { fmtCount, fmtHours } from "@/lib/admin/format";
import { loadOverview } from "@/lib/admin/page-data";

export const dynamic = "force-dynamic";
export const metadata = { title: "Kinerja pemeriksaan | Admin Yuktanya" };

export default async function ReviewsOpsPage({ searchParams }: { searchParams: Promise<{ r?: string }> }) {
  const { o, range } = await loadOverview(await searchParams);
  const b = o.reviews.backlog_by_age;
  return (
    <main className="max-w-5xl space-y-6">
      <PageHeading title="Kinerja pemeriksaan" />
      <RangeNav path="/admin/reviews" range={range} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard label="Belum ditugaskan" value={fmtCount(o.reviews.unassigned)} hint="Tugaskan di halaman Penugasan pemeriksaan" />
        <KpiCard label="Antrean < 24 jam" value={fmtCount(b.lt_24h)} />
        <KpiCard label="Antrean 1–3 hari" value={fmtCount(b.d1_3)} />
        <KpiCard label="Antrean > 3 hari" value={fmtCount(b.gt_3d)} />
        <KpiCard label="Legal Review selesai" value={fmtCount(o.reviews.completed)} />
        <KpiCard label="Waktu selesai (median)" value={fmtHours(o.reviews.sla_median_hours)} hint="Dari pembayaran terverifikasi sampai selesai. Target waktu layanan belum ditetapkan." />
        <KpiCard label="Waktu selesai (P95)" value={fmtHours(o.reviews.sla_p95_hours)} />
      </div>
      <Link className="inline-flex min-h-12 items-center font-semibold text-link underline underline-offset-4" href="/admin/routing">Buka Penugasan pemeriksaan</Link>
    </main>
  );
}

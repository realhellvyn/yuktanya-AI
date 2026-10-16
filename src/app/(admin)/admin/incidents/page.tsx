import Link from "next/link";
import { KpiCard } from "@/components/admin/kpi-card";
import { RangeNav } from "@/components/admin/range-nav";
import { fmtCount } from "@/lib/admin/format";
import { loadOverview } from "@/lib/admin/page-data";

export const dynamic = "force-dynamic";

export default async function IncidentsPage({ searchParams }: { searchParams: Promise<{ r?: string }> }) {
  const { o, range } = await loadOverview(await searchParams);
  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <h1 className="text-3xl font-semibold">Insiden</h1>
      <RangeNav path="/admin/incidents" range={range} />
      <div className="grid gap-4 md:grid-cols-3">
        <KpiCard label="Pembayaran perlu rekonsiliasi" value={fmtCount(o.incidents.reconciliation)} hint="Saat ini, bukan per rentang" />
        <KpiCard label="Email gagal terkirim" value={fmtCount(o.incidents.failed_outbox)} hint="Saat ini" />
        <KpiCard label="Permintaan AI gagal" value={fmtCount(o.incidents.ai_failures)} />
      </div>
      <Link className="inline-flex min-h-12 items-center underline" href="/admin/payments">Selesaikan rekonsiliasi pembayaran</Link>
    </main>
  );
}

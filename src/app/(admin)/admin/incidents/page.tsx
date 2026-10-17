import { PageHeading } from "@/components/ui/card";
import Link from "next/link";
import { KpiCard } from "@/components/admin/kpi-card";
import { RangeNav } from "@/components/admin/range-nav";
import { fmtCount } from "@/lib/admin/format";
import { loadOverview } from "@/lib/admin/page-data";

export const dynamic = "force-dynamic";
export const metadata = { title: "Insiden | Admin Yuktanya" };

export default async function IncidentsPage({ searchParams }: { searchParams: Promise<{ r?: string }> }) {
  const { o, range } = await loadOverview(await searchParams);
  return (
    <main className="max-w-5xl space-y-6">
      <PageHeading title="Insiden" />
      <RangeNav path="/admin/incidents" range={range} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard label="Pembayaran perlu rekonsiliasi" value={fmtCount(o.incidents.reconciliation)} hint="Saat ini, bukan per rentang" />
        <KpiCard label="Email gagal terkirim" value={fmtCount(o.incidents.failed_outbox)} hint="Saat ini" />
        <KpiCard label="Permintaan AI gagal" value={fmtCount(o.incidents.ai_failures)} />
      </div>
      <Link className="inline-flex min-h-12 items-center font-semibold text-link underline underline-offset-4" href="/admin/payments">Selesaikan rekonsiliasi pembayaran</Link>
    </main>
  );
}

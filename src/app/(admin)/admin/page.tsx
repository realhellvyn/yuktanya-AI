import Link from "next/link";
import { KpiCard } from "@/components/admin/kpi-card";
import { RangeNav } from "@/components/admin/range-nav";
import { fmtCount, fmtIdr, fmtPercent } from "@/lib/admin/format";
import { loadOverview } from "@/lib/admin/page-data";

export const dynamic = "force-dynamic";
const NAV = [
  ["/admin/analytics", "Funnel"], ["/admin/ai-usage", "Pemakaian AI"], ["/admin/reviews", "Operasi review"], ["/admin/revenue", "Pendapatan"],
  ["/admin/users", "Pengguna"], ["/admin/incidents", "Insiden"], ["/admin/payments", "Pembayaran"], ["/admin/routing", "Perutean review"],
  ["/admin/partners", "Mitra hukum"], ["/admin/verifications", "Pencabutan verifikasi"], ["/admin/rubric", "Persetujuan rubrik Enhanced"], ["/admin/features", "Kunci fitur per plan"],
] as const;

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ r?: string }> }) {
  const { o, range } = await loadOverview(await searchParams);
  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <h1 className="text-3xl font-semibold">Dashboard Admin Platform</h1>
      <RangeNav path="/admin" range={range} />
      <section aria-labelledby="kpi-h" className="space-y-3">
        <h2 id="kpi-h" className="text-2xl font-semibold">Ringkasan</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <KpiCard label="Pengguna terdaftar" value={fmtCount(o.users.registered)} hint={`Baru: ${fmtCount(o.users.new)}`} />
          <KpiCard label="Permintaan AI" value={fmtCount(o.ai?.requests)} hint={`Berhasil: ${fmtPercent(o.ai?.success_rate)}`} />
          <KpiCard label="Dokumen dimulai" value={fmtCount(o.documents.started)} hint={`Versi dibuat: ${fmtCount(o.documents.versions)}`} />
          <KpiCard label="Review dibayar (kohort baru)" value={fmtCount(o.funnel.review_paid)} hint={`dari ${fmtCount(o.funnel.registered)} pengguna baru`} />
          <KpiCard label="Pendapatan dikumpulkan" value={fmtIdr(o.revenue?.collected)} hint="Dari pembayaran terverifikasi, bukan laba" />
          <KpiCard label="Member aktif" value={fmtCount(o.revenue?.memberships_active)} />
        </div>
      </section>
      <section aria-labelledby="ops-h" className="space-y-3">
        <h2 id="ops-h" className="text-2xl font-semibold">Perlu tindakan</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <KpiCard label="Review belum ditugaskan" value={fmtCount(o.reviews.unassigned)} />
          <KpiCard label="Perlu rekonsiliasi pembayaran" value={fmtCount(o.incidents.reconciliation)} />
          <KpiCard label="Email gagal terkirim" value={fmtCount(o.incidents.failed_outbox)} />
        </div>
      </section>
      <nav aria-label="Modul admin"><ul className="grid gap-1 md:grid-cols-2">{NAV.map(([href, label]) => <li key={href}><Link className="inline-flex min-h-12 items-center underline" href={href}>{label}</Link></li>)}</ul></nav>
    </main>
  );
}

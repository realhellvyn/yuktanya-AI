import Link from "next/link";
import { PageHeading } from "@/components/ui/card";
import { ADMIN_NAV } from "@/lib/admin/nav";
import { KpiCard } from "@/components/admin/kpi-card";
import { RangeNav } from "@/components/admin/range-nav";
import { fmtCount, fmtIdr, fmtPercent } from "@/lib/admin/format";
import { loadOverview } from "@/lib/admin/page-data";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ringkasan | Admin Yuktanya" };

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ r?: string }> }) {
  const { o, range } = await loadOverview(await searchParams);
  return (
    <main className="max-w-5xl space-y-8">
      <PageHeading title="Dashboard Admin Platform" lead="Ringkasan operasional. Admin merutekan dan mencatat; admin tidak menilai isi hukum atau menerbitkan hasil pemeriksaan." />
      <RangeNav path="/admin" range={range} />
      <section aria-labelledby="kpi-h" className="space-y-3">
        <h2 id="kpi-h" className="text-xl font-bold text-navy md:text-2xl">Ringkasan</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <KpiCard label="Pengguna terdaftar" value={fmtCount(o.users.registered)} hint={`Baru: ${fmtCount(o.users.new)}`} />
          <KpiCard label="Permintaan AI" value={fmtCount(o.ai?.requests)} hint={`Berhasil: ${fmtPercent(o.ai?.success_rate)}`} />
          <KpiCard label="Dokumen dimulai" value={fmtCount(o.documents.started)} hint={`Versi dibuat: ${fmtCount(o.documents.versions)}`} />
          <KpiCard label="Review dibayar (kohort baru)" value={fmtCount(o.funnel.review_paid)} hint={`dari ${fmtCount(o.funnel.registered)} pengguna baru`} />
          <KpiCard label="Pendapatan dikumpulkan" value={fmtIdr(o.revenue?.collected)} hint="Dari pembayaran terverifikasi, bukan laba" />
          <KpiCard label="Member aktif" value={fmtCount(o.members.active)} />
        </div>
      </section>
      <section aria-labelledby="ops-h" className="space-y-3">
        <h2 id="ops-h" className="text-xl font-bold text-navy md:text-2xl">Perlu tindakan</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <KpiCard label="Review belum ditugaskan" value={fmtCount(o.reviews.unassigned)} />
          <KpiCard label="Perlu rekonsiliasi pembayaran" value={fmtCount(o.incidents.reconciliation)} />
          <KpiCard label="Email gagal terkirim" value={fmtCount(o.incidents.failed_outbox)} />
        </div>
      </section>
      <section aria-labelledby="modul-h" className="space-y-3">
        <h2 id="modul-h" className="text-xl font-bold text-navy md:text-2xl">Semua modul admin</h2>
        <nav aria-label="Modul admin">
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {ADMIN_NAV.filter((n) => n.href !== "/admin").map((n) => (
              <li key={n.href}><Link className="flex min-h-12 items-center rounded-xl border border-line bg-surface px-4 font-semibold text-link hover:bg-subtle" href={n.href}>{n.label}</Link></li>
            ))}
          </ul>
        </nav>
      </section>
    </main>
  );
}

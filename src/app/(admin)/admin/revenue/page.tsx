import { PageHeading } from "@/components/ui/card";
import { KpiCard } from "@/components/admin/kpi-card";
import { RangeNav } from "@/components/admin/range-nav";
import { fmtCount, fmtIdr } from "@/lib/admin/format";
import { loadOverview } from "@/lib/admin/page-data";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pendapatan | Admin Yuktanya" };
const KIND: Record<string, string> = { MEMBERSHIP_MONTHLY: "Membership bulanan", MEMBERSHIP_ANNUAL: "Membership tahunan", BUNDLE: "Paket kredit", STANDARD_REVIEW: "Pemeriksaan standar", DEEP_REVIEW: "Pemeriksaan mendalam" };

export default async function RevenuePage({ searchParams }: { searchParams: Promise<{ r?: string }> }) {
  const { o, range } = await loadOverview(await searchParams);
  const r = o.revenue;
  return (
    <main className="max-w-5xl space-y-6">
      <PageHeading title="Pendapatan" />
      <RangeNav path="/admin/revenue" range={range} />
      <p>&ldquo;Dikumpulkan&rdquo; adalah uang dari pembayaran yang sudah terverifikasi, bukan laba. &ldquo;Sedang ditahan&rdquo; adalah uang yang sudah masuk dan menunggu keputusan rekonsiliasi, termasuk uang yang diterima tetapi belum terverifikasi (pembayaran ganda atau terlambat); pembayaran yang pernah terverifikasi sebelum ditahan juga tetap terhitung di &ldquo;Dikumpulkan&rdquo;. Biaya mitra, biaya AI, dan pajak belum dicatat sehingga margin tidak ditampilkan. Membership ditampilkan sebagai pendapatan membership bulanan karena perpanjangan dilakukan manual.</p>
      {r === null && <p role="status">Belum ada pembayaran terverifikasi pada rentang ini.</p>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard label="Dikumpulkan" value={fmtIdr(r?.collected)} />
        <KpiCard label="Sedang ditahan" value={fmtIdr(r?.held)} hint="Uang yang sudah masuk dan menunggu keputusan rekonsiliasi, termasuk pembayaran ganda atau terlambat" />
        <KpiCard label="Pengembalian dana (dicatat)" value={fmtIdr(r?.refunds)} />
        <KpiCard label="Bersih dikumpulkan" value={fmtIdr(r?.net)} />
        <KpiCard label="Biaya transaksi" value={fmtIdr(r?.fees)} hint="Ditampilkan terpisah" />
        <KpiCard label="Pengguna yang membayar" value={fmtCount(r?.paying_users)} />
        <KpiCard label="Member aktif akhir rentang" value={fmtCount(o.members.active)} />
      </div>
      {r && (
        <div className="overflow-x-auto rounded-2xl border border-line bg-white"><table className="w-full border-collapse">
          <caption className="p-3 text-left text-xl font-bold text-navy">Per jenis layanan</caption>
          <thead><tr><th scope="col" className="border-b border-line p-3 text-left">Layanan</th><th scope="col" className="border-b border-line p-3 text-right">Dikumpulkan</th></tr></thead>
          <tbody>{Object.entries(r.collected_by_kind).map(([k, v]) => <tr key={k}><th scope="row" className="border-b border-line p-3 text-left font-normal">{KIND[k] ?? k}</th><td className="border-b border-line p-3 text-right">{fmtIdr(v)}</td></tr>)}</tbody>
        </table></div>
      )}
    </main>
  );
}

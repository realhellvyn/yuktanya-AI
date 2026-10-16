import { KpiCard } from "@/components/admin/kpi-card";
import { RangeNav } from "@/components/admin/range-nav";
import { fmtCount, fmtIdr } from "@/lib/admin/format";
import { loadOverview } from "@/lib/admin/page-data";

export const dynamic = "force-dynamic";
const KIND: Record<string, string> = { MEMBERSHIP_MONTHLY: "Membership bulanan", MEMBERSHIP_ANNUAL: "Membership tahunan", BUNDLE: "Paket kredit", STANDARD_REVIEW: "Pemeriksaan standar", DEEP_REVIEW: "Pemeriksaan mendalam" };

export default async function RevenuePage({ searchParams }: { searchParams: Promise<{ r?: string }> }) {
  const { o, range } = await loadOverview(await searchParams);
  const r = o.revenue;
  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <h1 className="text-3xl font-semibold">Pendapatan</h1>
      <RangeNav path="/admin/revenue" range={range} />
      <p>Angka berikut adalah uang yang dikumpulkan dari pembayaran yang sudah terverifikasi, bukan laba. Biaya mitra, biaya AI, dan pajak belum dicatat sehingga margin tidak ditampilkan. Membership ditampilkan sebagai pendapatan membership bulanan karena perpanjangan dilakukan manual.</p>
      {r === null && <p role="status">Belum ada pembayaran terverifikasi pada rentang ini.</p>}
      <div className="grid gap-4 md:grid-cols-3">
        <KpiCard label="Dikumpulkan" value={fmtIdr(r?.collected)} />
        <KpiCard label="Sedang ditahan" value={fmtIdr(r?.held)} hint="Pernah terverifikasi, kini dalam rekonsiliasi" />
        <KpiCard label="Pengembalian dana (dicatat)" value={fmtIdr(r?.refunds)} />
        <KpiCard label="Bersih dikumpulkan" value={fmtIdr(r?.net)} />
        <KpiCard label="Biaya transaksi" value={fmtIdr(r?.fees)} hint="Ditampilkan terpisah" />
        <KpiCard label="Pengguna yang membayar" value={fmtCount(r?.paying_users)} />
        <KpiCard label="Member aktif akhir rentang" value={fmtCount(o.members.active)} />
      </div>
      {r && (
        <table className="w-full border-collapse">
          <caption className="text-left text-xl font-semibold">Per jenis layanan</caption>
          <thead><tr><th scope="col" className="border p-2 text-left">Layanan</th><th scope="col" className="border p-2 text-right">Dikumpulkan</th></tr></thead>
          <tbody>{Object.entries(r.collected_by_kind).map(([k, v]) => <tr key={k}><th scope="row" className="border p-2 text-left font-normal">{KIND[k] ?? k}</th><td className="border p-2 text-right">{fmtIdr(v)}</td></tr>)}</tbody>
        </table>
      )}
    </main>
  );
}

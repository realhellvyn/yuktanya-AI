import Link from "next/link";
import { KpiCard } from "@/components/admin/kpi-card";
import { TrendChart } from "@/components/admin/trend-chart";
import { Card, PageHeading } from "@/components/ui/card";
import { buttonClass } from "@/components/ui/button";
import { fieldClass, labelText } from "@/components/ui/field";
import { buildAlerts, CATEGORIES, compareText, MEMBERSHIPS, type SeriesKey } from "@/lib/admin/analytics";
import { fmtCount, fmtIdr, NO_DATA } from "@/lib/admin/format";
import { loadAnalytics } from "@/lib/admin/page-data";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Analitik dan tren | Admin Yuktanya" };

type Q = { r?: string; dari?: string; sampai?: string; jenis?: string; anggota?: string };
const ymd = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
const lastDay = (to: Date) => ymd(new Date(to.getTime() - 1));
const longDay = (d: Date) => d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" });

const CARDS: { key: SeriesKey; label: string; idr?: boolean }[] = [
  { key: "new_users", label: "Pengguna baru" },
  { key: "docs_started", label: "Dokumen dimulai" },
  { key: "drafts_completed", label: "Versi dokumen dibekukan" },
  { key: "ai_messages", label: "Pesan AI berhasil" },
  { key: "reviews_requested", label: "Review Standar diminta" },
  { key: "reviews_paid", label: "Review Standar dibayar" },
  { key: "reviews_completed", label: "Review Standar selesai" },
  { key: "revenue", label: "Uang terkumpul", idr: true },
];
const CHARTS: { key: SeriesKey; label: string; idr?: boolean; note?: string }[] = [
  { key: "new_users", label: "Pengguna baru per hari", note: "Tidak berlaku untuk filter jenis dokumen" },
  { key: "docs_started", label: "Dokumen dimulai per hari" },
  { key: "ai_messages", label: "Pesan AI berhasil per hari", note: "Tidak berlaku untuk filter jenis dokumen" },
  { key: "ai_failed", label: "Permintaan AI gagal per hari", note: "Belum ada catatan permintaan AI, atau tidak berlaku untuk filter jenis dokumen" },
  { key: "reviews_requested", label: "Review Standar diminta per hari" },
  { key: "reviews_paid", label: "Review Standar dibayar per hari" },
  { key: "reviews_completed", label: "Review Standar selesai per hari" },
  { key: "revenue", label: "Uang terkumpul per hari", idr: true },
];
const OUTCOME: Record<string, string> = { WITH_NOTES: "Dengan catatan", WITHIN_SCOPE: "Sesuai lingkup", INCONCLUSIVE: "Belum dapat disimpulkan", DECLINED: "Ditolak", UNKNOWN: "Tanpa hasil" };
const DEEP_OUTCOME: Record<string, string> = { ENHANCED_APPROVED: "Enhanced disetujui", COMPLETED_WITH_NOTES: "Selesai dengan catatan", INCONCLUSIVE: "Belum dapat disimpulkan", REFERRED_SPECIAL_CASE: "Dirujuk ke kasus khusus", UNKNOWN: "Tanpa hasil" };
const KIND: Record<string, string> = { AI: "AI Verified", LEGAL: "Legal Verified", LEGAL_ENHANCED: "Enhanced" };
const list = (rec: Record<string, number>, names: Record<string, string>) =>
  Object.keys(rec).length === 0 ? "0" : Object.entries(rec).map(([k, n]) => `${names[k] ?? k}: ${fmtCount(n)}`).join(", ");

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Q> }) {
  const { query, current, previous, o } = await loadAnalytics(await searchParams);
  const alerts = buildAlerts(current.alerts);
  const keep = new URLSearchParams();
  if (query.category) keep.set("jenis", query.category);
  if (query.membership) keep.set("anggota", query.membership);
  const preset = (r: string) => `/admin/analytics?${new URLSearchParams({ r, ...Object.fromEntries(keep) })}`;
  const custom = !!(query.typed.dari || query.typed.sampai);
  const filterText = [
    query.category ? CATEGORIES.find((c) => c.value === query.category)?.label : "Semua jenis dokumen",
    query.membership ? MEMBERSHIPS.find((m) => m.value === query.membership)?.label : "Semua pengguna",
  ].join(", ");
  const f = o.funnel;
  const funnel: [string, number][] = [
    ["Terdaftar", f.registered], ["Pernah memakai AI", f.ai_used], ["Memulai dokumen", f.doc_started], ["Membuat versi dokumen", f.version_created],
    ["Meminta review", f.review_requested], ["Review dibayar", f.review_paid], ["Review selesai", f.review_completed],
  ];
  const q = current.quality;

  return (
    <main className="max-w-5xl space-y-8">
      <PageHeading title="Analitik dan tren" lead="Angka harian dihitung dari data transaksi (zona waktu WIB). Admin hanya melihat jumlah, bukan isi dokumen atau catatan hukum." />

      {query.error && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 font-semibold text-red-800">{query.error}</p>}

      <section aria-labelledby="filter-h" className="space-y-3">
        <h2 id="filter-h" className="text-xl font-bold text-navy md:text-2xl">Rentang dan filter</h2>
        <nav aria-label="Rentang cepat" className="flex flex-wrap gap-2">
          {[["1", "Hari ini"], ["7", "7 hari"], ["30", "30 hari"]].map(([r, label]) => {
            const on = !custom && !query.error && query.days === Number(r);
            return (
              <Link key={r} href={preset(r)} aria-current={on ? "page" : undefined}
                className={cn("inline-flex min-h-12 items-center rounded-xl border px-4 font-semibold", on ? "border-brand bg-blue-50 text-brand-dark" : "border-slate-400 bg-white text-ink hover:bg-slate-50")}>
                {label}{on ? " (dipilih)" : ""}
              </Link>
            );
          })}
        </nav>
        <Card>
          <form method="get" action="/admin/analytics" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block"><span className={labelText}>Dari tanggal</span>
              <input type="date" name="dari" defaultValue={query.typed.dari || ymd(query.from)} className={fieldClass} /></label>
            <label className="block"><span className={labelText}>Sampai tanggal</span>
              <input type="date" name="sampai" defaultValue={query.typed.sampai || lastDay(query.to)} className={fieldClass} /></label>
            <label className="block"><span className={labelText}>Jenis dokumen</span>
              <select name="jenis" defaultValue={query.category ?? ""} className={fieldClass}>
                <option value="">Semua jenis</option>
                {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select></label>
            <label className="block"><span className={labelText}>Keanggotaan</span>
              <select name="anggota" defaultValue={query.membership ?? ""} className={fieldClass}>
                <option value="">Semua pengguna</option>
                {MEMBERSHIPS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select></label>
            <div className="sm:col-span-2 lg:col-span-4">
              <button type="submit" className={buttonClass("primary")}>Terapkan</button>
            </div>
          </form>
        </Card>
        <p role="status" data-testid="range-status">
          Menampilkan: <strong>{query.label}</strong> ({longDay(query.from)} sampai {longDay(new Date(query.to.getTime() - 1))}, WIB). {filterText}.
          {" "}Dibandingkan dengan {query.days} hari sebelumnya ({longDay(query.prevFrom)} sampai {longDay(new Date(query.prevTo.getTime() - 1))}).
        </p>
        <p className="text-muted">Filter keanggotaan memakai status pengguna pada saat kejadian. Filter jenis dokumen hanya berlaku untuk angka dokumen, review, dan uang dari review.</p>
      </section>

      <section aria-labelledby="alert-h" className="space-y-3">
        <h2 id="alert-h" className="text-xl font-bold text-navy md:text-2xl">Peringatan</h2>
        {alerts.length === 0 ? (
          <p>Tidak ada peringatan saat ini.</p>
        ) : (
          <ul className="space-y-2">
            {alerts.map((a) => <li key={a.code} className="rounded-xl border border-amber-400 bg-amber-50 p-4"><strong>Perlu dicek: </strong>{a.text}</li>)}
          </ul>
        )}
        <p className="text-muted">Batas antrean {current.alerts.overdue_hours} jam adalah ambang sementara; SLA belum disepakati dengan mitra hukum.</p>
      </section>

      <section aria-labelledby="kpi-h" className="space-y-3">
        <h2 id="kpi-h" className="text-xl font-bold text-navy md:text-2xl">Ringkasan periode</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="kpi">
          {CARDS.map((c) => {
            const v = current.totals[c.key];
            return <KpiCard key={c.key} label={c.label} value={c.idr ? fmtIdr(v) : fmtCount(v)} hint={v === null ? "Tidak berlaku untuk filter ini" : compareText(v, previous.totals[c.key])} />;
          })}
        </div>
        <p className="text-muted">Uang terkumpul berasal dari pembayaran terverifikasi, bukan laba.</p>
      </section>

      <section aria-labelledby="trend-h" className="space-y-3">
        <h2 id="trend-h" className="text-xl font-bold text-navy md:text-2xl">Tren harian</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {CHARTS.map((c) => <TrendChart key={c.key} id={`tren-${c.key}`} title={c.label} days={current.days} values={current.series[c.key]} format={c.idr ? "idr" : "count"} note={c.note} />)}
        </div>
      </section>

      <section aria-labelledby="quality-h" className="space-y-3">
        <h2 id="quality-h" className="text-xl font-bold text-navy md:text-2xl">Kualitas</h2>
        <Card>
          <dl className="grid gap-3 sm:grid-cols-2">
            <div><dt className="font-semibold">Hasil Review Standar selesai</dt><dd>{list(q.reviews_by_outcome, OUTCOME)}</dd></div>
            <div><dt className="font-semibold">Legal Note diterbitkan</dt><dd>{fmtCount(q.legal_notes_published)}</dd></div>
            <div><dt className="font-semibold">Verifikasi terbit</dt><dd>{list(q.verifications_issued, KIND)}</dd></div>
            <div><dt className="font-semibold">Verifikasi dicabut</dt><dd>{fmtCount(q.verifications_revoked)}</dd></div>
            <div><dt className="font-semibold">Hasil Pemeriksaan Mendalam</dt><dd>{list(q.deep_by_outcome, DEEP_OUTCOME)}</dd></div>
            <div><dt className="font-semibold">Keluaran AI tidak terbaca</dt><dd>{fmtCount(q.ai_malformed)}</dd></div>
            <div><dt className="font-semibold">Keluhan</dt><dd>{q.complaints === null ? `${NO_DATA} (belum dicatat sistem)` : fmtCount(q.complaints)}</dd></div>
          </dl>
        </Card>
        <p className="text-muted">Angka Enhanced bukan target penjualan. Hasil pemeriksaan ditentukan profesional hukum.</p>
      </section>

      <section aria-labelledby="funnel-h" className="space-y-3">
        <h2 id="funnel-h" className="text-xl font-bold text-navy md:text-2xl">Funnel kohort</h2>
        <p>Kohort tetap: pengguna yang mendaftar pada rentang ini ({fmtCount(f.registered)} orang). Setiap langkah menghitung pengguna unik dari kohort itu, kapan pun langkah itu terjadi. Persentase memakai kohort sebagai penyebut. Filter tidak berlaku di tabel ini.</p>
        <div className="overflow-x-auto rounded-2xl border border-line bg-white"><table className="w-full border-collapse">
          <caption className="sr-only">Funnel kohort pendaftar</caption>
          <thead><tr><th scope="col" className="border-b border-line p-3 text-left">Langkah</th><th scope="col" className="border-b border-line p-3 text-right">Pengguna</th><th scope="col" className="border-b border-line p-3 text-right">% kohort</th></tr></thead>
          <tbody>{funnel.map(([label, n]) => <tr key={label}><th scope="row" className="border-b border-line p-3 text-left font-normal">{label}</th><td className="border-b border-line p-3 text-right">{fmtCount(n)}</td><td className="border-b border-line p-3 text-right">{f.registered > 0 ? `${Math.round((n / f.registered) * 100)}%` : NO_DATA}</td></tr>)}</tbody>
        </table></div>
      </section>
    </main>
  );
}

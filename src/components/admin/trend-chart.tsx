import { fmtCount, fmtIdr, NO_DATA } from "@/lib/admin/format";

const W = 600;
const H = 160;
const shortDay = (ymd: string) => new Date(`${ymd}T12:00:00+07:00`).toLocaleDateString("id-ID", { day: "numeric", month: "short", timeZone: "Asia/Jakarta" });

// Grafik batang harian satu seri, SVG sebaris (tanpa pustaka). Label sumbu di HTML agar tetap terbaca di layar HP;
// tiap batang punya tooltip bawaan (<title>), dan tabel angka tersedia untuk pembaca layar dan pembaca yang tidak memakai warna.
export function TrendChart({ id, title, days, values, format = "count", note }: {
  id: string; title: string; days: string[]; values: number[] | null; format?: "count" | "idr"; note?: string;
}) {
  const fmt = format === "idr" ? fmtIdr : fmtCount;
  if (!values) {
    return (
      <figure aria-labelledby={`${id}-t`} className="min-w-0 rounded-2xl border border-line bg-white p-4">
        <figcaption id={`${id}-t`} className="font-semibold text-navy">{title}</figcaption>
        <p className="mt-2 text-muted">{NO_DATA}{note ? `. ${note}` : ""}</p>
      </figure>
    );
  }
  const total = values.reduce((a, b) => a + Number(b), 0);
  const max = Math.max(...values.map(Number), 0);
  const slot = W / Math.max(values.length, 1);
  const gap = Math.min(2, slot * 0.2);
  const bw = Math.max(slot - gap, 0.5);
  const peakIdx = values.findIndex((v) => Number(v) === max);
  const summary = max === 0
    ? `${title}: tidak ada kejadian pada ${days.length} hari.`
    : `${title}: total ${fmt(total)} dalam ${days.length} hari; tertinggi ${fmt(max)} pada ${shortDay(days[peakIdx])}.`;
  return (
    <figure aria-labelledby={`${id}-t`} className="min-w-0 rounded-2xl border border-line bg-white p-4">
      <figcaption id={`${id}-t`} className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="font-semibold text-navy">{title}</span>
        <span className="text-muted">Total: <strong className="text-ink">{fmt(total)}</strong></span>
      </figcaption>
      <p className="mt-1 text-sm text-muted">{max === 0 ? "Tidak ada kejadian pada rentang ini." : `Tertinggi: ${fmt(max)}`}</p>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={summary} className={max === 0 ? "mt-1 block h-6 w-full" : "mt-1 block h-32 w-full"}>
        <line x1="0" y1={H - 0.5} x2={W} y2={H - 0.5} stroke="var(--color-line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        {values.map((v, i) => {
          const n = Number(v);
          const h = max > 0 ? Math.max((n / max) * (H - 4), n > 0 ? 2 : 0) : 0;
          return (
            <g key={days[i]}>
              <rect x={i * slot} y={0} width={slot} height={H} fill="transparent" />
              {h > 0 && <rect x={i * slot + gap / 2} y={H - h} width={bw} height={h} rx={Math.min(2, bw / 2)} fill="var(--color-brand)" />}
              <title>{`${shortDay(days[i])}: ${fmt(n)}`}</title>
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between text-sm text-muted" aria-hidden="true">
        <span>{shortDay(days[0])}</span>
        {days.length > 1 && <span>{shortDay(days[days.length - 1])}</span>}
      </div>
      <details className="mt-2">
        <summary className="flex min-h-12 cursor-pointer items-center font-semibold text-brand">Lihat angka per hari</summary>
        <div className="max-h-64 overflow-auto">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">{title} per hari</caption>
            <thead><tr><th scope="col" className="border-b border-line py-1">Tanggal</th><th scope="col" className="border-b border-line py-1 text-right">Jumlah</th></tr></thead>
            <tbody>{days.map((d, i) => <tr key={d}><th scope="row" className="py-1 font-normal">{shortDay(d)}</th><td className="py-1 text-right">{fmt(Number(values[i]))}</td></tr>)}</tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

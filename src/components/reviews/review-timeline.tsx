const STEPS = ["Diajukan", "Pembayaran dikonfirmasi", "Dalam antrean", "Sedang diperiksa", "Selesai"] as const;
// Status permintaan → langkah terakhir yang sudah dicapai.
const REACHED: Record<string, number> = { QUEUED: 2, ASSIGNED: 2, IN_REVIEW: 3, COMPLETED: 4, DECLINED: 4, CANCELLED: 0 };

export function ReviewTimeline({ status }: { status: string }) {
  const reached = REACHED[status] ?? 0;
  return (
    <ol aria-label="Tahapan pemeriksaan" className="space-y-2">
      {STEPS.map((s, i) => (
        <li key={s} className="flex items-center gap-2">
          <span aria-hidden="true" className={i <= reached ? "font-bold" : "text-slate-500"}>{i <= reached ? "✓" : "○"}</span>
          <span className={i === reached ? "font-semibold" : undefined}>{s}</span>
          <span className="text-slate-700">{i < reached ? "— selesai" : i === reached ? "— tahap ini" : "— belum"}</span>
        </li>
      ))}
    </ol>
  );
}

import type { OwnerReview } from "@/lib/reviews/service";

const STEPS = ["Diajukan", "Pembayaran dikonfirmasi", "Dalam antrean", "Sedang diperiksa", "Selesai"] as const;
// Status permintaan → langkah terakhir yang sudah dicapai.
const REACHED: Record<string, number> = { QUEUED: 2, ASSIGNED: 2, IN_REVIEW: 3, COMPLETED: 4, DECLINED: 4 };
const date = (iso: string) => new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(iso));

// Tahapan pemeriksaan dengan tanggal tiap tahap (D-14). Tanggal tahap "Sedang diperiksa" = saat ditugaskan ke pemeriksa.
export function ReviewTimeline({ status, timeline }: { status: string; timeline?: OwnerReview["timeline"] }) {
  const at = timeline ? [timeline.orderedAt, timeline.paidAt, timeline.queuedAt, timeline.assignedAt, timeline.completedAt] : [];
  const cancelled = status === "CANCELLED";
  // Dibatalkan: tahap terakhir yang benar-benar tercatat, tanpa "tahap ini".
  const reached = cancelled ? at.reduce<number>((n, d, i) => (d ? i : n), -1) : REACHED[status] ?? 0;
  return (
    <ol aria-label="Tahapan Legal Review" className="space-y-2">
      {STEPS.map((s, i) => {
        const done = cancelled ? i <= reached : i < reached || (i === reached && i === STEPS.length - 1);
        const current = !cancelled && i === reached && !done;
        return (
          <li key={s} className="flex flex-wrap items-baseline gap-x-2">
            <span aria-hidden="true" className={i <= reached ? "font-bold" : "text-muted"}>{i <= reached ? "✓" : "○"}</span>
            <span className={current ? "font-semibold" : undefined}>{s}</span>
            <span className="text-muted">{done ? "(selesai)" : current ? "(tahap saat ini)" : "(belum)"}</span>
            {at[i] && i <= reached && <span className="text-muted">({date(at[i]!)} WIB)</span>}
          </li>
        );
      })}
      {cancelled && <li className="font-semibold">Dibatalkan: pengajuan ini tidak dilanjutkan.</li>}
    </ol>
  );
}

export function StepIndicator({ current, total, percent, label }: { current: number; total: number; percent: number; label?: string }) {
  return (
    <div>
      <div className="flex items-center justify-between text-sm font-semibold text-muted">
        <span>{label ?? `Langkah ${current} dari ${total}`}</span>
        <span>{percent}% terisi</span>
      </div>
      <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="Kemajuan pengisian">
        <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

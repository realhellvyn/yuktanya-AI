export function StepIndicator({ current, total, percent }: { current: number; total: number; percent: number }) {
  return (
    <div>
      <div className="flex items-center justify-between text-sm font-semibold text-muted">
        <span>Langkah {current} dari {total}</span>
        <span>{percent}% terisi</span>
      </div>
      <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="Kemajuan pengisian">
        <div className="h-full rounded-full bg-brand" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

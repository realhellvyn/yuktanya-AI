export function KpiCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-line bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <p className="font-semibold text-muted">{label}</p>
      <p className="mt-1 break-words text-3xl font-bold text-navy">{value}</p>
      {hint && <p className="mt-1 text-muted">{hint}</p>}
    </div>
  );
}

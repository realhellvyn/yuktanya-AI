export function KpiCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <p className="font-medium">{label}</p>
      <p className="text-2xl font-semibold">{value}</p>
      {hint && <p className="text-slate-700">{hint}</p>}
    </div>
  );
}

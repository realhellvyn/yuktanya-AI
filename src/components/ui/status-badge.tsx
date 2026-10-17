import { cn } from "@/lib/utils";

const TONES = {
  info: "border-border-strong bg-tint text-navy",
  success: "border-green-300 bg-green-50 text-green-900",
  warning: "border-amber-400 bg-amber-50 text-amber-900",
  danger: "border-red-300 bg-red-50 text-red-900",
  neutral: "border-line bg-subtle text-ink",
} as const;
const MARK = { info: "ℹ", success: "✓", warning: "!", danger: "✕", neutral: "•" } as const;

// Status selalu berupa teks + simbol, bukan warna saja (DESIGN_SYSTEM).
export function StatusBadge({ tone = "neutral", children }: { tone?: keyof typeof TONES; children: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold", TONES[tone])}>
      <span aria-hidden="true">{MARK[tone]}</span>
      {children}
    </span>
  );
}

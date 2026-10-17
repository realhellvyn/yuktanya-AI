import Link from "next/link";
import type { Range } from "@/lib/admin/format";
import { cn } from "@/lib/utils";

const OPTIONS: { r: string; label: string; days: number }[] = [{ r: "1", label: "Hari ini", days: 1 }, { r: "7", label: "7 hari", days: 7 }, { r: "30", label: "30 hari", days: 30 }];

// Rentang waktu dalam zona WIB; pilihan aktif ditandai dengan teks, bukan warna saja.
export function RangeNav({ path, range }: { path: string; range: Range }) {
  return (
    <nav aria-label="Rentang waktu" className="flex flex-wrap items-center gap-2">
      {OPTIONS.map((o) => {
        const on = o.days === range.days;
        return (
          <Link key={o.r} href={`${path}?r=${o.r}`} aria-current={on ? "page" : undefined}
            className={cn("inline-flex min-h-12 items-center rounded-xl border px-4 font-semibold", on ? "border-primary bg-tint text-navy" : "border-border-strong bg-surface text-ink hover:bg-subtle")}>
            {o.label}{on ? " (dipilih)" : ""}
          </Link>
        );
      })}
      <span className="w-full text-muted sm:w-auto">Zona waktu: WIB. Rentang: {range.label}.</span>
    </nav>
  );
}

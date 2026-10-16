import Link from "next/link";
import type { Range } from "@/lib/admin/format";

const OPTIONS: { r: string; label: string; days: number }[] = [{ r: "1", label: "Hari ini", days: 1 }, { r: "7", label: "7 hari", days: 7 }, { r: "30", label: "30 hari", days: 30 }];

// Rentang waktu dalam zona WIB; pilihan aktif ditandai dengan teks, bukan warna saja.
export function RangeNav({ path, range }: { path: string; range: Range }) {
  return (
    <nav aria-label="Rentang waktu" className="flex flex-wrap items-center gap-3">
      {OPTIONS.map((o) => (
        <Link key={o.r} href={`${path}?r=${o.r}`} aria-current={o.days === range.days ? "page" : undefined}
          className="inline-flex min-h-12 items-center rounded-lg border border-slate-400 bg-white px-4 font-medium">
          {o.label}{o.days === range.days ? " (dipilih)" : ""}
        </Link>
      ))}
      <span>Zona waktu: WIB. Rentang: {range.label}.</span>
    </nav>
  );
}

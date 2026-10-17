import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Logo header (brand kit HeaderAplikasi): mark kecil navy 32px + wordmark "Yuktanya" serif 700 berwarna heading.
// alt mark kosong karena nama "Yuktanya" sudah ada sebagai teks di sebelahnya. Berkas mark: public/brand/.
export function BrandLogo({ href, compact, sub, className }: { href: string; compact?: boolean; sub?: ReactNode; className?: string }) {
  return (
    <Link href={href} className={cn("inline-flex min-h-12 min-w-0 items-center gap-2.5", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- SVG statis kecil, tidak perlu optimasi gambar */}
      <img src="/brand/yuktanya-mark-small-navy.svg" alt="" width={29} height={32} className="h-8 w-auto shrink-0" />
      <span className="flex min-w-0 flex-col justify-center">
        <Wordmark className={compact ? "text-2xl" : "text-[1.625rem]"} />
        {sub}
      </span>
    </Link>
  );
}

// Wordmark: satu-satunya pemakaian font serif di aplikasi.
export function Wordmark({ className }: { className?: string }) {
  return <span className={cn("font-serif font-bold leading-none tracking-normal text-heading", className)}>Yuktanya</span>;
}

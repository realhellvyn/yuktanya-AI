import Link from "next/link";
import { BrandLogo } from "./brand-logo";

// home: pengguna sudah masuk → tombol kembali ke aplikasi menggantikan "Masuk".
export function SiteHeader({ home }: { home?: string } = {}) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur">
      <nav className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-2 md:px-8" aria-label="Menu utama">
        <BrandLogo href="/" />
        <div className="flex items-center gap-2">
          <Link href="/pricing" className="inline-flex min-h-12 items-center rounded-xl px-3 font-semibold text-heading hover:bg-subtle">Harga</Link>
          {home ? (
            <Link href={home} className="inline-flex min-h-12 items-center rounded-xl border border-border-strong bg-surface px-5 font-semibold text-heading hover:bg-subtle">Kembali ke aplikasi</Link>
          ) : (
            <Link href="/login" className="inline-flex min-h-12 items-center rounded-xl border border-border-strong bg-surface px-5 font-semibold text-heading hover:bg-subtle">Masuk</Link>
          )}
        </div>
      </nav>
    </header>
  );
}

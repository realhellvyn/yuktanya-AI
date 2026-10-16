import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-white/95 backdrop-blur">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-2 md:px-8" aria-label="Menu utama">
        <Link href="/" className="inline-flex min-h-12 items-center text-2xl font-bold tracking-tight text-navy">Yuktanya</Link>
        <div className="flex items-center gap-2">
          <Link href="/pricing" className="inline-flex min-h-12 items-center rounded-xl px-3 font-semibold text-ink hover:bg-slate-100">Harga</Link>
          <Link href="/login" className="inline-flex min-h-12 items-center rounded-xl border border-slate-400 bg-white px-5 font-semibold text-ink hover:bg-slate-50">Masuk</Link>
        </div>
      </nav>
    </header>
  );
}

import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="border-b border-slate-300 bg-white">
      <nav className="mx-auto flex max-w-5xl items-center justify-between p-4" aria-label="Menu utama">
        <Link href="/" className="text-xl font-semibold text-slate-900">Yuktanya</Link>
        <div className="flex gap-4">
          <Link href="/pricing" className="underline">Harga</Link>
          <Link href="/login" className="underline">Masuk</Link>
        </div>
      </nav>
    </header>
  );
}

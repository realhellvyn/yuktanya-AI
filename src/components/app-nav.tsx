import Link from "next/link";

const LINKS = [
  { href: "/dashboard", label: "Beranda" },
  { href: "/workspace/new", label: "Buat Dokumen" },
  { href: "/documents", label: "Dokumen Saya" },
  { href: "/vault", label: "Vault" },
];

export function AppNav() {
  return (
    <header className="border-b border-slate-300 bg-white">
      <nav aria-label="Menu aplikasi" className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 p-4">
        <Link href="/dashboard" className="inline-flex min-h-12 items-center text-xl font-semibold">Yuktanya</Link>
        {LINKS.map((l) => <Link key={l.href} href={l.href} className="inline-flex min-h-12 items-center underline">{l.label}</Link>)}
      </nav>
    </header>
  );
}

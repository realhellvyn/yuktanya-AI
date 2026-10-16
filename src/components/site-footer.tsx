import { SLOGAN } from "@/lib/copy";
import { ButtonLink } from "@/components/ui/button";

export const FOOTER_LINKS = [
  { href: "/pricing", label: "Harga" },
  { href: "/bantuan", label: "Bantuan" },
  { href: "/privacy", label: "Kebijakan Privasi" },
  { href: "/terms", label: "Syarat Penggunaan" },
] as const;

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-muted md:px-8">
        <p>© Yuktanya. {SLOGAN}</p>
        <nav aria-label="Tautan bawah" className="flex flex-wrap gap-x-2">
          {FOOTER_LINKS.map((l) => <ButtonLink key={l.href} href={l.href} variant="quiet">{l.label}</ButtonLink>)}
        </nav>
      </div>
    </footer>
  );
}

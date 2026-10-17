"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

// Satu sumber menu untuk sidebar (desktop) dan tab bawah (HP). Tautan hanya ke rute yang ada.
// Label mengikuti USER_DASHBOARD (Mobile navigation): sidebar memuat Bantuan; tab bawah Beranda, Buat Dokumen, Dokumen Saya, Akun.
export const NAV = [
  { href: "/dashboard", label: "Beranda", short: "Beranda", icon: "M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" },
  { href: "/workspace/new", label: "Buat Dokumen", short: "Buat Dokumen", icon: "M12 5v14M5 12h14" },
  { href: "/documents", label: "Dokumen Saya", short: "Dokumen Saya", icon: "M7 3h7l5 5v13H7zM14 3v5h5" },
  { href: "/reviews", label: "Legal Review Saya", short: "Legal Review", icon: "M5 12l4 4L19 6" },
  { href: "/cases", label: "Special Legal Case", short: "Special Legal Case", icon: "M4 8h16v12H4zM9 8V5h6v3M4 13h16" },
  { href: "/vault", label: "Legal Vault", short: "Vault", icon: "M5 10V7a7 7 0 0 1 14 0v3M4 10h16v11H4z" },
  { href: "/membership", label: "Membership", short: "Membership", icon: "M3 7h18v10H3zM3 11h18" },
  { href: "/bantuan", label: "Bantuan", short: "Bantuan", icon: "M9 9a3 3 0 1 1 4 2.8c-.6.3-1 .9-1 1.6V15M12 18h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18" },
  { href: "/settings", label: "Pengaturan", short: "Pengaturan", icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2-1.2L14 3h-4l-.4 2.7a7 7 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2 1.2L10 21h4l.4-2.7a7 7 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2" },
] as const;
// Tab bawah (HP). "Akun" membuka Pengaturan, yang menautkan Membership; tab ini aktif juga di /membership.
const ACCOUNT_ICON = "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 21a8 8 0 0 1 16 0";
const BOTTOM = [
  { href: "/dashboard", short: "Beranda", icon: NAV[0].icon, also: [] as string[] },
  { href: "/workspace/new", short: "Buat Dokumen", icon: NAV[1].icon, also: ["/workspace"] },
  { href: "/documents", short: "Dokumen Saya", icon: NAV[2].icon, also: [] as string[] },
  { href: "/settings", short: "Akun", icon: ACCOUNT_ICON, also: ["/membership"] },
];

const isActive = (path: string, href: string) => (href === "/dashboard" ? path === href : path === href || path.startsWith(href + "/"));

function Icon({ d }: { d: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

export function SideNav() {
  const path = usePathname();
  return (
    <nav aria-label="Menu aplikasi" className="flex flex-col gap-1">
      {NAV.map((l) => {
        const on = isActive(path, l.href);
        return (
          <Link key={l.href} href={l.href} aria-current={on ? "page" : undefined}
            className={cn("flex min-h-12 items-center gap-3 rounded-xl px-4 text-base font-semibold", on ? "bg-tint text-navy ring-1 ring-line" : "text-ink hover:bg-subtle")}>
            <Icon d={l.icon} />
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function BottomNav() {
  const path = usePathname();
  return (
    <nav aria-label="Menu utama" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden">
      <ul className="mx-auto grid max-w-xl grid-cols-4">
        {BOTTOM.map((l) => {
          const on = isActive(path, l.href) || l.also.some((p) => isActive(path, p));
          return (
            <li key={l.href}>
              <Link href={l.href} aria-current={on ? "page" : undefined}
                className={cn("flex min-h-16 flex-col items-center justify-center gap-0.5 px-1 text-center text-sm font-semibold leading-tight", on ? "font-bold text-navy" : "text-muted")}>
                <span className={cn("rounded-full px-4 py-1", on && "bg-tint")}><Icon d={l.icon} /></span>
                {l.short}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

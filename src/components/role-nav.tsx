"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export type RoleNavItem = { href: string; label: string };

const isActive = (path: string, href: string, root: string) => (href === root ? path === href : path === href || path.startsWith(href + "/"));

function Links({ items, root, label }: { items: readonly RoleNavItem[]; root: string; label: string }) {
  const path = usePathname();
  return (
    <nav aria-label={label}>
      <ul className="flex flex-col gap-1">
        {items.map((l) => {
          const on = isActive(path, l.href, root);
          return (
            <li key={l.href}>
              <Link href={l.href} aria-current={on ? "page" : undefined}
                className={cn("flex min-h-12 items-center rounded-xl px-4 text-base font-semibold", on ? "bg-blue-50 text-brand-dark ring-1 ring-blue-200" : "text-ink hover:bg-slate-100")}>
                {l.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function RoleSideNav(props: { items: readonly RoleNavItem[]; root: string; label: string }) {
  return <Links {...props} />;
}

// Menu HP: daftar tautan di bawah tombol "Menu"; tertutup lagi setiap kali halaman berganti.
export function RoleMobileMenu(props: { items: readonly RoleNavItem[]; root: string; label: string }) {
  const path = usePathname();
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.open = false;
  }, [path]);
  const current = props.items.find((i) => isActive(path, i.href, props.root));
  return (
    <details ref={ref} className="group">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 rounded-xl border border-slate-400 bg-white px-4 font-semibold text-ink [&::-webkit-details-marker]:hidden">
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
        Menu<span className="sr-only">{current ? `, halaman ini: ${current.label}` : ""}</span>
      </summary>
      <div className="absolute inset-x-0 top-full z-30 max-h-[70vh] overflow-y-auto border-b border-line bg-white p-3 shadow-lg">
        <Links {...props} />
      </div>
    </details>
  );
}

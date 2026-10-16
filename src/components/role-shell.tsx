import Link from "next/link";
import { SignOutForm } from "./sign-out-form";
import { RoleMobileMenu, RoleSideNav, type RoleNavItem } from "./role-nav";

// Kerangka dashboard mitra hukum dan admin platform: sidebar di desktop, tombol Menu di HP. Gaya sama dengan AppShell pengguna.
export function RoleShell({ root, area, items, children }: { root: string; area: string; items: readonly RoleNavItem[]; children: React.ReactNode }) {
  const label = `Menu ${area}`;
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[17rem_1fr]">
      <aside className="hidden border-r border-line bg-white lg:block">
        <div className="sticky top-0 flex h-screen flex-col gap-6 overflow-y-auto p-5">
          <div>
            <Link href={root} className="inline-flex min-h-12 items-center text-2xl font-bold tracking-tight text-navy">Yuktanya</Link>
            <p className="text-sm font-semibold uppercase tracking-wide text-muted">{area}</p>
          </div>
          <RoleSideNav items={items} root={root} label={label} />
          <SignOutForm className="mt-auto">
            <button type="submit" className="flex min-h-12 w-full items-center rounded-xl px-4 text-base font-semibold text-muted hover:bg-slate-100">Keluar</button>
          </SignOutForm>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-2 border-b border-line bg-white px-4 py-2 lg:hidden">
          <Link href={root} className="inline-flex min-h-12 min-w-0 flex-col justify-center leading-tight">
            <span className="text-xl font-bold text-navy">Yuktanya</span>
            <span className="truncate text-xs font-semibold uppercase tracking-wide text-muted">{area}</span>
          </Link>
          <div className="flex items-center gap-1">
            <RoleMobileMenu items={items} root={root} label={label} />
            <SignOutForm>
              <button type="submit" className="inline-flex min-h-12 items-center rounded-lg px-3 font-semibold text-muted">Keluar</button>
            </SignOutForm>
          </div>
        </header>
        <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 md:px-8 lg:pb-12 lg:pt-10">{children}</div>
      </div>
    </div>
  );
}

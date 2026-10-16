import Link from "next/link";
import { SignOutForm } from "./sign-out-form";
import { BottomNav, SideNav } from "./app-nav";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[17rem_1fr]">
      <aside className="hidden border-r border-line bg-white lg:block">
        <div className="sticky top-0 flex h-screen flex-col gap-6 p-5">
          <Link href="/dashboard" className="inline-flex min-h-12 items-center text-2xl font-bold tracking-tight text-navy">Yuktanya</Link>
          <SideNav />
          <SignOutForm className="mt-auto">
            <button type="submit" className="flex min-h-12 w-full items-center rounded-xl px-4 text-base font-semibold text-muted hover:bg-slate-100">Keluar</button>
          </SignOutForm>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-white px-4 py-2 lg:hidden">
          <Link href="/dashboard" className="inline-flex min-h-12 items-center text-xl font-bold text-navy">Yuktanya</Link>
          <div className="flex items-center">
            <Link href="/bantuan" className="inline-flex min-h-12 items-center rounded-lg px-3 font-semibold text-muted">Bantuan</Link>
            <SignOutForm>
              <button type="submit" className="inline-flex min-h-12 items-center rounded-lg px-3 font-semibold text-muted">Keluar</button>
            </SignOutForm>
          </div>
        </header>
        <div className="mx-auto w-full max-w-6xl px-4 pb-28 pt-6 md:px-8 lg:pb-12 lg:pt-10">{children}</div>
        <BottomNav />
      </div>
    </div>
  );
}

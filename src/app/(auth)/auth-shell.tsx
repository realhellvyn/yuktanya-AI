import Link from "next/link";
import { Card } from "@/components/ui/card";

export function AuthShell({ title, children, footer }: { title: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4 py-10">
      <Link href="/" className="inline-flex min-h-12 items-center self-start text-2xl font-bold tracking-tight text-navy">Yuktanya</Link>
      <Card className="space-y-5 !p-6 md:!p-8">
        <h1 className="text-[1.75rem] font-bold leading-tight text-navy">{title}</h1>
        {children}
      </Card>
      {footer && <p className="text-center">{footer}</p>}
    </main>
  );
}

export const linkClass = "inline-flex min-h-12 items-center font-semibold text-brand-dark underline";

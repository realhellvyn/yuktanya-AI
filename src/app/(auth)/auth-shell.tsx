import { BrandLogo } from "@/components/brand-logo";
import { Card } from "@/components/ui/card";

export function AuthShell({ title, children, footer }: { title: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4 py-10">
      <BrandLogo href="/" className="self-start" />
      <Card className="space-y-5 !p-6 md:!p-8">
        <h1 className="text-[1.75rem] font-bold leading-tight text-navy">{title}</h1>
        {children}
      </Card>
      {footer && <p className="text-center">{footer}</p>}
    </main>
  );
}

export const linkClass = "inline-flex min-h-12 items-center font-semibold text-link underline";

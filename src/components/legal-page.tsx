import type { ReactNode } from "react";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Card, PageHeading } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";

export const LEGAL_PENDING = "Menunggu persetujuan mitra hukum";

export type LegalSection = { id: string; title: string; body: ReactNode };

// Halaman hukum hanya menjelaskan perilaku sistem yang sungguh ada. Setiap bagian ditandai belum disetujui mitra hukum.
export function LegalPage({ title, lead, sections }: { title: string; lead: string; sections: LegalSection[] }) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-8 md:px-8">
        <PageHeading title={title} lead={lead} />
        <Card className="space-y-2 border-amber-300 bg-amber-50">
          <StatusBadge tone="warning">{LEGAL_PENDING}</StatusBadge>
          <p>Halaman ini masih draf. Isinya menjelaskan cara kerja sistem saat ini, bukan nasihat hukum. Wording hukumnya belum disetujui mitra hukum kami.</p>
        </Card>
        {sections.map((s) => (
          <section key={s.id} aria-labelledby={s.id}>
            <Card className="space-y-3">
              <h2 id={s.id} className="text-xl font-bold text-navy">{s.title}</h2>
              <div className="space-y-2">{s.body}</div>
              <StatusBadge tone="warning">{LEGAL_PENDING}</StatusBadge>
            </Card>
          </section>
        ))}
      </main>
      <SiteFooter />
    </>
  );
}

export const ul = "list-disc space-y-1.5 pl-6";

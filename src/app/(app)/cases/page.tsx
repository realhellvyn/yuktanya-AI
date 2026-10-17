import { ButtonLink } from "@/components/ui/button";
import { Card, EmptyState, PageHeading } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { SPECIAL_CASE_NOTE } from "@/lib/copy";
import { casesService } from "@/lib/cases/runtime";
import { CASE_STATUS_LABEL, CASE_STATUS_TONE, caseErrorText, formatWib } from "@/lib/cases/view";
import { requireUserId } from "@/lib/documents/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Kasus Khusus Saya | Yuktanya" };

export default async function CasesPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const q = await searchParams;
  const userId = await requireUserId();
  const rows = await casesService().listForOwner(userId);
  return (
    <main className="max-w-3xl space-y-6">
      <PageHeading title="Kasus Khusus" lead="Permintaan penilaian khusus oleh firma hukum mitra." actions={<ButtonLink href="/cases/new">Ajukan penilaian khusus</ButtonLink>} />
      {q.notice === "khusus" && <p role="alert" className="rounded-xl border border-amber-400 bg-amber-50 p-4 font-semibold">{caseErrorText("SPECIAL_CASE_OPEN")}</p>}
      <p className="rounded-xl border border-line bg-surface p-4">{SPECIAL_CASE_NOTE}</p>
      {rows.length === 0 ? (
        <EmptyState title="Belum ada permintaan penilaian khusus" text="Gunakan bila dokumen Anda rumit atau berisiko tinggi dan tidak cocok untuk pemeriksaan standar oleh pengacara." />
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.id}>
              <Card className="flex flex-wrap items-center justify-between gap-3 !p-4">
                <div className="min-w-0 space-y-1.5">
                  <p className="break-words text-lg font-bold text-navy">{r.documentTitle ?? "Tanpa dokumen terkait"}</p>
                  <p className="text-muted">Diajukan {formatWib(r.createdAt)}</p>
                  <StatusBadge tone={CASE_STATUS_TONE[r.status]}>{CASE_STATUS_LABEL[r.status]}</StatusBadge>
                </div>
                <ButtonLink href={`/cases/${r.id}`} variant="secondary">Lihat</ButtonLink>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

import { notFound } from "next/navigation";
import { DeepResult } from "@/components/deep/deep-result";
import { EnhancedRubricNotice } from "@/components/deep/enhanced-availability";
import { Card, PageHeading } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { DEEP_PAYMENT_STATEMENT, LEGAL_DISCLAIMER } from "@/lib/copy";
import { loadDeepStatusPage } from "@/lib/deep/owner-pages";
import { deepTimeline, enhancedExplanation } from "@/lib/deep/owner-view";
import { deepService } from "@/lib/deep/runtime";
import { requireUserId } from "@/lib/documents/session";
import { verifyUrl } from "@/lib/verification/qr";

export const metadata = { title: "Deep Review | Yuktanya" };

export const dynamic = "force-dynamic";
const HOLD: Record<string, string> = {
  ON_HOLD: "Deep Review ditahan karena verifikasi Legal Review dicabut atau ditangguhkan. Anda akan diberi tahu bila pemeriksaan berlanjut.",
  CANCELLED: "Deep Review ini dibatalkan.",
};

export default async function DeepStatusPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await requireUserId();
  const page = await loadDeepStatusPage(deepService(), userId, id);
  if (page.kind === "notFound") notFound();
  const { deep } = page;
  const steps = deepTimeline({ status: deep.status, assigned: page.assigned });
  const completed = deep.status === "COMPLETED";
  const why = enhancedExplanation(deep.outcome, deep.decisionReason, deep.verification?.status ?? null);
  // Selama Deep Review belum selesai, pemilik diberi tahu bila Enhanced saat ini belum dapat terbit (rubrik belum disetujui).
  const rubricApproved = completed ? true : await deepService().rubricApproved();
  return (
    <main className="max-w-3xl space-y-6">
      <PageHeading title="Deep Review" lead="Pemeriksaan tambahan oleh profesional hukum atas Legal Note dari Legal Review Anda." />
      <Card className="space-y-3">
        <h2 className="text-xl font-semibold">Tahapan</h2>
        <ol aria-label="Tahapan Deep Review" className="space-y-2">
          {steps.map((s) => (
            <li key={s.label} className="flex flex-wrap items-center gap-2">
              <span aria-hidden="true" className={s.state === "todo" ? "text-muted" : "font-bold"}>{s.state === "done" ? "✓" : s.state === "current" ? "●" : "○"}</span>
              <span className={s.state === "current" ? "font-semibold" : undefined}>{s.label}</span>
              <span className="text-muted">{s.state === "done" ? "(selesai)" : s.state === "current" ? "(tahap saat ini)" : "(belum)"}</span>
            </li>
          ))}
        </ol>
        {HOLD[deep.status] && <p role="status" className="font-semibold">{HOLD[deep.status]}</p>}
      </Card>
      {completed ? (
        <>
          <Card className="space-y-2">
            <h2 className="text-xl font-semibold">{why.headline}</h2>
            <p>{why.text}</p>
            <p>Batasan: pemeriksaan hanya berlaku untuk versi dokumen dan ruang lingkup yang diperiksa. {DEEP_PAYMENT_STATEMENT}</p>
          </Card>
          <DeepResult deep={deep} verifyUrl={deep.verification ? verifyUrl(deep.verification.code) : undefined} />
        </>
      ) : (
        <Card className="space-y-2">
          <p>Hasil akan tampil di halaman ini setelah profesional hukum selesai memeriksa.</p>
          <EnhancedRubricNotice rubricApproved={rubricApproved} />
          <p>{DEEP_PAYMENT_STATEMENT}</p>
          <p>{LEGAL_DISCLAIMER}</p>
        </Card>
      )}
      <ButtonLink href={`/reviews/${deep.parentRequestId}`} variant="secondary">Kembali ke hasil Legal Review</ButtonLink>
    </main>
  );
}

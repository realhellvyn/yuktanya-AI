import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DocumentPreview } from "@/components/documents/document-preview";
import { WizardStep } from "@/components/documents/wizard-step";
import { PartialPreview } from "@/components/documents/partial-preview";
import { StepIndicator } from "@/components/ui/step-indicator";
import { Card } from "@/components/ui/card";
import { renderDocument, renderPartial } from "@/lib/documents/render";
import { documentsService } from "@/lib/documents/runtime";
import { requireUserId } from "@/lib/documents/session";
import { TEMPLATES } from "@/lib/documents/templates/registry";
import { buildSteps, nextMissing, progress, summarize } from "@/lib/documents/wizard";
import { ASSIST_NOTICES } from "@/lib/vault/messages";
import { freezeAction, saveStepAction } from "../../documents/actions";
import { assistAction } from "../../documents/vault-actions";
import { AssistBox } from "@/components/documents/assist-box";

// Halaman memakai sesi dan DB: tidak boleh diprarender saat build.
export const dynamic = "force-dynamic";

export default async function WorkspacePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ step?: string; error?: string; assist?: string }> }) {
  const { id } = await params;
  const q = await searchParams;
  const userId = await requireUserId();
  const doc = await documentsService().get(userId, id);
  if (!doc) notFound();
  const t = TEMPLATES[doc.category];
  const data = doc.draft.data;
  const missing = nextMissing(t, data);
  const showSummary = q.step === "ringkasan" || (!q.step && missing === null);
  const bar = progress(t, data);

  if (showSummary) {
    let preview = null;
    try {
      preview = renderDocument(t, data, "DRAFT");
    } catch {
      preview = null;
    }
    return (
      <main className="max-w-3xl space-y-6">
        <h1 className="text-[1.75rem] font-bold leading-tight tracking-tight text-navy md:text-4xl">Periksa jawaban Anda</h1>
        {q.assist && ASSIST_NOTICES[q.assist] && <p role="status" className="rounded-xl border border-line bg-white p-4">{ASSIST_NOTICES[q.assist]}</p>}
        <AssistBox documentId={id} action={assistAction} />
        {q.error && <p role="alert" className="rounded-lg border border-red-700 bg-white p-4 text-red-800">{q.error}</p>}
        <dl className="space-y-3 rounded-xl border border-line bg-white p-4">
          {summarize(t, data).map((s, i) => (
            <div key={s.label}>
              <dt className="font-semibold">{s.label}</dt>
              <dd>{s.value} <Link className="ml-2 inline-flex min-h-12 items-center text-brand-dark underline" href={`/workspace/${id}?step=${i + 1}`}>Ubah</Link></dd>
            </div>
          ))}
        </dl>
        {preview ? <DocumentPreview doc={preview} /> : <p>Lengkapi dulu pertanyaan yang wajib diisi untuk melihat pratinjau.</p>}
        {missing ? (
          <Link className="inline-flex min-h-12 items-center rounded-lg bg-brand px-6 font-semibold text-white" href={`/workspace/${id}?step=${missing.index}`}>Lanjutkan mengisi</Link>
        ) : (
          <form action={freezeAction} className="space-y-3">
            <input type="hidden" name="documentId" value={id} />
            <input type="hidden" name="token" value={randomUUID()} />
            <button type="submit" className="min-h-12 w-full rounded-lg bg-brand px-6 text-lg font-semibold text-white">Buat dokumen</button>
            <p>Dokumen yang dibuat tidak dapat diubah. Jika perlu perubahan, Anda membuat versi baru.</p>
          </form>
        )}
        {doc.versions.length > 0 && <Link className="inline-flex min-h-12 items-center text-brand-dark underline" href={`/documents/${id}`}>Lihat versi yang sudah dibuat</Link>}
      </main>
    );
  }

  const steps = buildSteps(t);
  const index = Math.min(Math.max(Number(q.step) || missing?.index || 1, 1), steps.length);
  const step = steps[index - 1];
  const rows = renderPartial(t, data);
  const preview = <PartialPreview title={t.title} rows={rows} />;
  return (
    <main className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-8">
      <div className="max-w-2xl space-y-5">
        <h1 className="text-[1.75rem] font-bold leading-tight tracking-tight text-navy md:text-3xl">{t.title}</h1>
        <StepIndicator current={index} total={steps.length} percent={bar.percent} />
        {q.assist && ASSIST_NOTICES[q.assist] && <p role="status" className="rounded-xl border border-line bg-white p-4">{ASSIST_NOTICES[q.assist]}</p>}
        <Card>
          <WizardStep
            step={step}
            documentId={id}
            revision={doc.draft.revision}
            action={saveStepAction}
            value={data[step.field.key]}
            error={q.error}
            backHref={index > 1 ? `/workspace/${id}?step=${index - 1}` : undefined}
          />
        </Card>
        {bar.done > 0 && <p role="status" className="text-sm font-semibold text-success">✓ Tersimpan. {bar.done} dari {bar.total} pertanyaan wajib sudah terisi.</p>}
        <AssistBox documentId={id} action={assistAction} />
        <details className="rounded-2xl border border-line bg-white p-4 lg:hidden">
          <summary className="inline-flex min-h-12 cursor-pointer items-center font-semibold text-brand-dark">Lihat draf dokumen</summary>
          <div className="mt-3">{preview}</div>
        </details>
      </div>
      <aside className="hidden lg:block" aria-label="Draf dokumen">
        <div className="sticky top-8 max-h-[calc(100vh-4rem)] overflow-y-auto">{preview}</div>
      </aside>
    </main>
  );
}

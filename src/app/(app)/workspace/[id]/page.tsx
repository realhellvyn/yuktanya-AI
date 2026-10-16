import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DocumentPreview } from "@/components/documents/document-preview";
import { WizardStep } from "@/components/documents/wizard-step";
import { renderDocument } from "@/lib/documents/render";
import { documentsService } from "@/lib/documents/runtime";
import { requireUserId } from "@/lib/documents/session";
import { TEMPLATES } from "@/lib/documents/templates/registry";
import { buildSteps, nextMissing, progress, summarize } from "@/lib/documents/wizard";
import { freezeAction, saveStepAction } from "../../documents/actions";

export default async function WorkspacePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ step?: string; error?: string }> }) {
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
      <main className="mx-auto max-w-3xl space-y-6 p-6">
        <h1 className="text-3xl font-semibold">Periksa jawaban Anda</h1>
        {q.error && <p role="alert" className="rounded-lg border border-red-700 bg-white p-4 text-red-800">{q.error}</p>}
        <dl className="space-y-3 rounded-lg border border-slate-300 bg-white p-4">
          {summarize(t, data).map((s, i) => (
            <div key={s.label}>
              <dt className="font-semibold">{s.label}</dt>
              <dd>{s.value} <Link className="ml-2 text-blue-700 underline" href={`/workspace/${id}?step=${i + 1}`}>Ubah</Link></dd>
            </div>
          ))}
        </dl>
        {preview ? <DocumentPreview doc={preview} /> : <p>Lengkapi dulu pertanyaan yang wajib diisi untuk melihat pratinjau.</p>}
        {missing ? (
          <Link className="inline-flex min-h-12 items-center rounded-lg bg-blue-600 px-6 font-semibold text-white" href={`/workspace/${id}?step=${missing.index}`}>Lanjutkan mengisi</Link>
        ) : (
          <form action={freezeAction} className="space-y-3">
            <input type="hidden" name="documentId" value={id} />
            <input type="hidden" name="token" value={randomUUID()} />
            <button type="submit" className="min-h-12 w-full rounded-lg bg-blue-600 px-6 text-lg font-semibold text-white">Buat dokumen</button>
            <p>Dokumen yang dibuat tidak dapat diubah. Jika perlu perubahan, Anda membuat versi baru.</p>
          </form>
        )}
        {doc.versions.length > 0 && <Link className="text-blue-700 underline" href={`/documents/${id}`}>Lihat versi yang sudah dibuat</Link>}
      </main>
    );
  }

  const steps = buildSteps(t);
  const index = Math.min(Math.max(Number(q.step) || missing?.index || 1, 1), steps.length);
  const step = steps[index - 1];
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-3xl font-semibold">{t.title}</h1>
      <p role="status">Terisi {bar.done} dari {bar.total} pertanyaan wajib ({bar.percent}%). Jawaban tersimpan setiap kali Anda menekan Lanjut.</p>
      <WizardStep
        step={step}
        documentId={id}
        revision={doc.draft.revision}
        action={saveStepAction}
        value={data[step.field.key]}
        error={q.error}
        backHref={index > 1 ? `/workspace/${id}?step=${index - 1}` : undefined}
      />
    </main>
  );
}

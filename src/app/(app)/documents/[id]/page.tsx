import Link from "next/link";
import { notFound } from "next/navigation";
import { DocumentPreview } from "@/components/documents/document-preview";
import { VersionList } from "@/components/documents/version-list";
import { VaultPanel } from "@/components/vault/vault-panel";
import { diffRendered } from "@/lib/documents/diff";
import { documentsService } from "@/lib/documents/runtime";
import { requireUserId } from "@/lib/documents/session";
import { getPool } from "@/lib/db";
import { hasFeature } from "@/lib/vault/features";
import { reminderService, shareService } from "@/lib/vault/runtime";
import { buildPackAction, cancelReminderAction, createShareAction, revokeShareAction, setReminderAction } from "../vault-actions";
import { cloneAction, exportAction, startNewVersionAction } from "../actions";

// Halaman memakai sesi dan DB: tidak boleh diprarender saat build.
export const dynamic = "force-dynamic";

const LABEL = { changed: "Diubah", added: "Ditambah", removed: "Dihapus", same: "Sama" } as const;

export default async function DocumentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ version?: string; against?: string; exported?: string; baru?: string; error?: string; pack?: string; notice?: string }> }) {
  const { id } = await params;
  const q = await searchParams;
  const userId = await requireUserId();
  const svc = documentsService();
  const doc = await svc.get(userId, id);
  if (!doc) notFound();
  const selectedId = q.version ?? doc.versions.at(-1)?.id;
  const selected = selectedId ? await svc.getVersion(userId, selectedId) : null;
  const against = q.against && selected ? await svc.getVersion(userId, q.against) : null;
  const pool = getPool();
  const [fShare, fRem, fEvid] = selected
    ? await Promise.all([hasFeature(pool, userId, "vault.share"), hasFeature(pool, userId, "vault.reminders"), hasFeature(pool, userId, "vault.evidence_pack")])
    : [false, false, false];
  const shares = selected && fShare ? await shareService().list(userId, selected.id) : [];
  const acks = selected && fShare ? await shareService().acknowledgements(userId, selected.id) : [];
  const reminderOptions = selected && fRem ? await reminderService().options(userId, selected.id) : [];
  const changes = selected && against ? diffRendered(against.doc, selected.doc).filter((c) => c.change !== "same") : null;

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-3xl font-semibold">{doc.title}</h1>
      {q.error === "pdf" && (
        <p role="alert" className="rounded-lg border border-red-700 bg-white p-4 text-red-800">
          PDF belum mendukung beberapa karakter di dokumen ini. Gunakan unduhan Word (DOCX).
        </p>
      )}
      {q.baru && <p role="status" className="rounded-lg border border-slate-300 bg-white p-4">Dokumen berhasil dibuat. Versi ini tidak dapat diubah.</p>}
      {doc.versions.length === 0 ? (
        <p>Belum ada versi. <Link className="inline-flex min-h-12 items-center text-blue-700 underline" href={`/workspace/${id}`}>Lanjutkan mengisi</Link></p>
      ) : (
        <VersionList documentId={id} versions={doc.versions} />
      )}
      {selected && (
        <section className="space-y-4" aria-label={`Versi ${selected.versionNo}`}>
          <h2 className="text-2xl font-semibold">Versi {selected.versionNo}</h2>
          <DocumentPreview doc={selected.doc} />
          {changes && (
            <div className="rounded-lg border border-slate-300 bg-white p-4">
              <h3 className="font-semibold">Perbedaan dengan versi sebelumnya</h3>
              {changes.length === 0 ? <p>Tidak ada perbedaan.</p> : (
                <ul className="space-y-2">
                  {changes.map((c) => <li key={c.id}><strong>{LABEL[c.change]}:</strong> {c.after ?? c.before}</li>)}
                </ul>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-3">
            {(["DOCX", "PDF"] as const).map((f) => (
              <form key={f} action={exportAction}>
                <input type="hidden" name="documentId" value={id} />
                <input type="hidden" name="versionId" value={selected.id} />
                <input type="hidden" name="format" value={f} />
                <button type="submit" className="min-h-12 rounded-lg border border-slate-400 bg-white px-5 font-medium">Unduh {f === "DOCX" ? "Word (DOCX)" : "PDF"}</button>
              </form>
            ))}
            <form action={startNewVersionAction}>
              <input type="hidden" name="documentId" value={id} />
              <input type="hidden" name="versionId" value={selected.id} />
              <button type="submit" className="min-h-12 rounded-lg bg-blue-600 px-5 font-semibold text-white">Buat versi baru dari versi ini</button>
            </form>
            <form action={cloneAction}>
              <input type="hidden" name="versionId" value={selected.id} />
              <button type="submit" className="min-h-12 rounded-lg border border-slate-400 bg-white px-5 font-medium">Salin menjadi dokumen baru</button>
            </form>
          </div>
          <VaultPanel
            documentId={id}
            versionId={selected.id}
            features={{ share: fShare, reminders: fRem, evidence: fEvid }}
            shares={shares}
            acks={acks}
            reminderOptions={reminderOptions}
            packId={q.pack}
            notice={q.notice}
            actions={{ createShare: createShareAction, revokeShare: revokeShareAction, setReminder: setReminderAction, cancelReminder: cancelReminderAction, buildPack: buildPackAction }}
          />
          {q.exported && <p role="status"><a className="inline-flex min-h-12 items-center text-blue-700 underline" href={`/api/documents/exports/${q.exported}`}>Berkas siap. Tekan di sini untuk mengunduh.</a></p>}
        </section>
      )}
    </main>
  );
}

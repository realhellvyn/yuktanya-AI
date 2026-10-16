import { notFound } from "next/navigation";
import { DocumentPreview } from "@/components/documents/document-preview";
import { VersionList } from "@/components/documents/version-list";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, EmptyState, PageHeading } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { VaultPanel } from "@/components/vault/vault-panel";
import { diffRendered } from "@/lib/documents/diff";
import { documentsService } from "@/lib/documents/runtime";
import { requireUserId } from "@/lib/documents/session";
import { getPool } from "@/lib/db";
import { VerificationPanel } from "@/components/verification/verification-panel";
import { billingService } from "@/lib/billing/runtime";
import { formatIdr } from "@/lib/pricing/catalog";
import { flags } from "@/lib/flags";
import { qrPng, verifyUrl } from "@/lib/verification/qr";
import { verificationService } from "@/lib/verification/runtime";
import { hasFeature } from "@/lib/vault/features";
import { reminderService, shareService } from "@/lib/vault/runtime";
import { buildPackAction, cancelReminderAction, createShareAction, revokeShareAction, setReminderAction } from "../vault-actions";
import { cloneAction, exportAction, startNewVersionAction } from "../actions";
import { requestReviewAction } from "../../checkout/actions";
import { aiReviewAction } from "../ai-review-action";
import { casesService } from "@/lib/cases/runtime";
import { SPECIAL_CASE_NOTE } from "@/lib/copy";

// Halaman memakai sesi dan DB: tidak boleh diprarender saat build.
export const dynamic = "force-dynamic";

const LABEL = { changed: "Diubah", added: "Ditambah", removed: "Dihapus", same: "Sama" } as const;

export default async function DocumentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ai?: string; version?: string; against?: string; exported?: string; baru?: string; error?: string; pack?: string; notice?: string }> }) {
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
  const verifications = selected ? await verificationService().forVersion(userId, selected.id) : [];
  const urls: Record<string, string> = {};
  const qrs: Record<string, string> = {};
  for (const v of verifications) {
    urls[v.id] = verifyUrl(v.code);
    if (v.status === "ACTIVE") qrs[v.id] = `data:image/png;base64,${Buffer.from(await qrPng(urls[v.id])).toString("base64")}`;
  }
  // Kasus khusus terbuka: Review Standar diblokir di database (order dan pratinjau harga); tampilkan arah ke kasusnya.
  const openCase = await casesService().openForDocument(userId, id);
  const quote = selected && !openCase ? await billingService().preview(userId, "STANDARD_REVIEW", selected.id).catch(() => null) : null;
  const changes = selected && against ? diffRendered(against.doc, selected.doc).filter((c) => c.change !== "same") : null;

  const when = (iso: string) => new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(iso));
  const selectedMeta = selected ? doc.versions.find((v) => v.id === selected.id) : undefined;
  const hasActive = verifications.some((v) => v.status === "ACTIVE");
  return (
    <main className="max-w-3xl space-y-6">
      <PageHeading title={doc.title} lead={selectedMeta ? `Versi ${selectedMeta.versionNo} · dibuat ${when(selectedMeta.createdAt)} WIB` : undefined} />
      {q.error === "pdf" && (
        <p role="alert" className="rounded-xl border border-danger bg-red-50 p-4 font-semibold text-danger">
          PDF belum mendukung beberapa karakter di dokumen ini. Gunakan unduhan Word (DOCX).
        </p>
      )}
      {q.baru && <p role="status" className="rounded-xl border border-green-300 bg-green-50 p-4 font-semibold text-success">✓ Dokumen berhasil dibuat. Versi ini tidak dapat diubah.</p>}
      {doc.versions.length === 0 && (
        <EmptyState title="Belum ada versi" action={<ButtonLink href={`/workspace/${id}`}>Lanjutkan mengisi</ButtonLink>} />
      )}
      {selected && (
        <>
          <Card className="space-y-4" aria-label={`Versi ${selected.versionNo}`}>
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge tone="info">{`Versi ${selected.versionNo}`}</StatusBadge>
              {!hasActive && <StatusBadge tone="warning">Versi baru belum diperiksa</StatusBadge>}
            </div>
            {q.exported && (
              <p role="status" className="rounded-xl border border-blue-300 bg-blue-50 p-4">
                <a className="inline-flex min-h-12 items-center font-semibold text-brand-dark underline" href={`/api/documents/exports/${q.exported}`}>
                  Berkas siap. Tekan di sini untuk mengunduh.
                </a>
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              {(["DOCX", "PDF"] as const).map((f) => (
                <form key={f} action={exportAction}>
                  <input type="hidden" name="documentId" value={id} />
                  <input type="hidden" name="versionId" value={selected.id} />
                  <input type="hidden" name="format" value={f} />
                  <Button type="submit" variant={f === "DOCX" ? "primary" : "secondary"}>Unduh {f === "DOCX" ? "Word (DOCX)" : "PDF"}</Button>
                </form>
              ))}
            </div>
          </Card>

          <DocumentPreview doc={selected.doc} />
          {changes && (
            <Card className="space-y-2">
              <h3 className="font-bold text-navy">Perbedaan dengan versi sebelumnya</h3>
              {changes.length === 0 ? <p>Tidak ada perbedaan.</p> : (
                <ul className="space-y-2">
                  {changes.map((c) => <li key={c.id}><strong>{LABEL[c.change]}:</strong> {c.after ?? c.before}</li>)}
                </ul>
              )}
            </Card>
          )}

          <section aria-labelledby="periksa-h" className="space-y-3">
            <h2 id="periksa-h" className="text-2xl font-bold text-navy">Pemeriksaan</h2>
            <VerificationPanel verifications={verifications} qrDataUrls={qrs} urls={urls} />
            {openCase && (
              <Card className="space-y-3 border-amber-300 bg-amber-50/60">
                <p className="text-lg font-semibold text-navy">Dokumen ini memerlukan penilaian khusus</p>
                <p>Review Standar tidak tersedia selama penilaian khusus berjalan. {SPECIAL_CASE_NOTE}</p>
                <ButtonLink href={`/cases/${openCase}`} variant="secondary">Lihat status penilaian khusus</ButtonLink>
              </Card>
            )}
            {quote && (
              <Card className="space-y-3 border-blue-200 bg-blue-50/60">
                <form action={requestReviewAction} className="space-y-3">
                  <input type="hidden" name="versionId" value={selected.id} />
                  <p>Pemeriksaan oleh pengacara untuk versi ini: <strong>{formatIdr(quote.amountIdr)}</strong>. Pembayaran adalah biaya pemeriksaan dan tidak menjamin hasil positif.</p>
                  <Button type="submit">Minta pemeriksaan pengacara</Button>
                </form>
                <div className="flex flex-wrap items-center gap-x-2 text-muted"><span>Dokumen Anda rumit atau berisiko tinggi?</span><ButtonLink href={`/cases/new?document=${id}`} variant="quiet" className="!px-0">Ajukan penilaian khusus</ButtonLink></div>
              </Card>
            )}
            {flags.aiPreReview && (
              <Card>
                <form action={aiReviewAction} className="space-y-3">
                  <input type="hidden" name="versionId" value={selected.id} />
                  <input type="hidden" name="documentId" value={id} />
                  <label className="flex min-h-12 items-center gap-3">
                    <input type="checkbox" name="consent" value="yes" required className="h-6 w-6" />
                    <span>Saya setuju isi dokumen ini dikirim ke layanan AI untuk dianalisis.</span>
                  </label>
                  <Button type="submit" variant="secondary">Analisis awal AI</Button>
                </form>
              </Card>
            )}
            {q.ai && <p role="status" className="rounded-xl border border-line bg-white p-3">{q.ai === "ok" ? "Analisis awal AI selesai dan tercatat di atas." : q.ai === "quota" ? "Batas analisis AI hari ini sudah tercapai." : "Analisis AI belum berhasil. Kuota Anda tidak terpakai."}</p>}
          </section>

          <details className="rounded-2xl border border-line bg-white p-4" open={Boolean(q.pack || q.notice)}>
            <summary className="inline-flex min-h-12 cursor-pointer items-center text-lg font-bold text-navy">Berbagi, pengingat, dan paket bukti</summary>
            <div className="mt-4">
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
            </div>
          </details>

          <details className="rounded-2xl border border-line bg-white p-4">
            <summary className="inline-flex min-h-12 cursor-pointer items-center text-lg font-bold text-navy">Ubah atau salin dokumen ({doc.versions.length} versi)</summary>
            <div className="mt-4 space-y-4">
              <div className="flex flex-wrap gap-3">
                <form action={startNewVersionAction}>
                  <input type="hidden" name="documentId" value={id} />
                  <input type="hidden" name="versionId" value={selected.id} />
                  <Button type="submit">Buat versi baru dari versi ini</Button>
                </form>
                <form action={cloneAction}>
                  <input type="hidden" name="versionId" value={selected.id} />
                  <Button type="submit" variant="secondary">Salin menjadi dokumen baru</Button>
                </form>
              </div>
              <VersionList documentId={id} versions={doc.versions} />
            </div>
          </details>
        </>
      )}
    </main>
  );
}

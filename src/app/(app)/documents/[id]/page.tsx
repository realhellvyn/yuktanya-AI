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
import { ReviewRequestCard } from "@/components/reviews/review-request-card";
import { billingService } from "@/lib/billing/runtime";
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
import { AI_REVIEW_CONSENT, SPECIAL_CASE_NOTE } from "@/lib/copy";
import { AiReviewResult } from "@/components/ai-review/ai-review-result";
import { AiReviewForm } from "@/components/ai-review/ai-review-form";
import { UploadHashes } from "@/components/ai-review/upload-hashes";
import { latestAiReport } from "@/lib/ai/prereview";
import { AI_REVIEW_STATUS_TEXT, type AiReviewStatus } from "@/lib/ai/review-status";
import { uploadRepo } from "@/lib/uploads/runtime";
import { ackEmailAvailable } from "@/lib/vault/email-config";
import { versionStatuses, versionStatusText, wasReviewed } from "@/lib/documents/version-status";
import { fixedText, isUuid } from "@/lib/query-text";
import { orNull } from "@/lib/or-null";

// Task 24 (A04): fungsi tidak boleh dipotong sebelum tenggat giliran AI 75 detik (+ baca berkas/DB); harus literal untuk Next.
export const maxDuration = 120;

// Halaman memakai sesi dan DB: tidak boleh diprarender saat build.
export const dynamic = "force-dynamic";
export const metadata = { title: "Dokumen | Yuktanya" };

const LABEL = { changed: "Diubah", added: "Ditambah", removed: "Dihapus", same: "Sama" } as const;

export default async function DocumentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ai?: string; unggah?: string; version?: string; against?: string; exported?: string; baru?: string; error?: string; pack?: string; notice?: string }> }) {
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
  // Special Legal Case terbuka: Legal Review diblokir di database (order dan pratinjau harga); tampilkan arah ke kasusnya.
  const openCase = await casesService().openForDocument(userId, id);
  const upload = doc.category === "UPLOAD" ? await uploadRepo().meta(userId, id) : null;
  const highRisk = upload?.riskLevel === "HIGH";
  const aiReport = selected ? await latestAiReport(pool, userId, selected.id) : null;
  const aiVerified = verifications.some((v) => v.kind === "AI" && v.status === "ACTIVE");
  const aiStatus = fixedText(AI_REVIEW_STATUS_TEXT, q.ai) ? (q.ai as AiReviewStatus) : null;
  // Versi yang sudah punya pesanan Legal Review aktif (menunggu bayar atau sudah dibayar) tidak ditawari harga lagi;
  // pratinjau harga di DB juga menolaknya (ALREADY_REVIEWED). Kartu menautkan ke pembayaran atau ke Legal Review itu.
  const reviewable = Boolean(selected && !openCase && !highRisk);
  // Bawaan review Task 23: galat lookup tidak menjatuhkan halaman (kartu kembali ke pratinjau harga); preview_price di DB tetap
  // menolak ALREADY_REVIEWED, jadi pemesanan ganda tetap tertolak di server.
  const activeReview = reviewable && selected ? await orNull(billingService().activeStandardReview(userId, selected.id), "active_standard_review_lookup_failed") : null;
  const quote = reviewable && selected && !activeReview ? await billingService().preview(userId, "STANDARD_REVIEW", selected.id).catch(() => null) : null;
  const changes = selected && against ? diffRendered(against.doc, selected.doc).filter((c) => c.change !== "same") : null;

  const when = (iso: string) => new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(iso));
  const selectedMeta = selected ? doc.versions.find((v) => v.id === selected.id) : undefined;
  const statuses = await versionStatuses(pool, userId, id);
  const selectedIdx = selected ? doc.versions.findIndex((v) => v.id === selected.id) : -1;
  const selectedStatus = selected
    ? versionStatusText(statuses[selected.id], doc.versions.slice(0, Math.max(0, selectedIdx)).some((v) => wasReviewed(statuses[v.id])))
    : null;
  // Nilai dari alamat hanya dipakai bila berbentuk ID; teks bebas tidak pernah masuk tautan.
  const exportedId = isUuid(q.exported) ? q.exported : null;
  const packId = isUuid(q.pack) ? q.pack : undefined;
  return (
    <main className="max-w-3xl space-y-6">
      <PageHeading title={doc.title} lead={selectedMeta ? `Versi ${selectedMeta.versionNo} · dibuat ${when(selectedMeta.createdAt)} WIB` : undefined} />
      {q.error === "pdf" && (
        <p role="alert" className="rounded-xl border border-danger bg-red-50 p-4 font-semibold text-danger">
          Beberapa karakter di dokumen ini belum dapat dicetak ke PDF. Unduh dokumen dalam format Word (DOCX).
        </p>
      )}
      {q.baru && <p role="status" className="rounded-xl border border-green-300 bg-green-50 p-4 font-semibold text-success">✓ Dokumen berhasil dibuat. Versi ini tidak dapat diubah.</p>}
      {q.unggah && upload && <p role="status" className="rounded-xl border border-green-300 bg-green-50 p-4 font-semibold text-success">✓ Berkas berhasil diunggah dan disimpan sebagai dokumen yang tidak dapat diubah.</p>}
      {doc.versions.length === 0 && (
        <EmptyState title="Belum ada versi" action={<ButtonLink href={`/workspace/${id}`}>Lanjutkan mengisi</ButtonLink>} />
      )}
      {selected && (
        <>
          <Card className="space-y-4" aria-label={`Versi ${selected.versionNo}`}>
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge tone="info">{`Versi ${selected.versionNo}`}</StatusBadge>
              {selectedStatus && <StatusBadge tone={selectedStatus.tone}>{selectedStatus.text}</StatusBadge>}
            </div>
            {exportedId && (
              <p role="status" className="rounded-xl border border-border-strong bg-tint p-4">
                <a className="inline-flex min-h-12 items-center font-semibold text-link underline" href={`/api/documents/exports/${exportedId}`}>
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

          {upload && (
            <Card className="space-y-2" aria-label="Berkas asli">
              <h2 className="text-lg font-bold text-navy">Berkas asli</h2>
              <p className="break-words">{upload.filename} · {upload.kind} · {(upload.byteSize / 1024).toFixed(1).replace(".", ",")} KB{upload.pages ? ` · ${upload.pages} halaman` : ""}</p>
              <UploadHashes versionSha256={selected.sha256} originalSha256={upload.originalSha256} />
              <p className="text-sm text-muted">Di bawah ini adalah teks hasil pembacaan berkas. Format asli seperti tabel, gambar, dan tanda tangan tidak ikut terbaca.</p>
            </Card>
          )}
          <DocumentPreview doc={selected.doc} />
          {changes && (
            <Card className="space-y-2">
              <h3 className="font-bold text-navy">Perbedaan dengan versi sebelumnya</h3>
              {changes.length === 0 ? <p>Tidak ada perbedaan dengan versi sebelumnya.</p> : (
                <ul className="space-y-2">
                  {changes.map((c) => <li key={c.id}><strong>{LABEL[c.change]}:</strong> {c.after ?? c.before}</li>)}
                </ul>
              )}
            </Card>
          )}

          <section aria-labelledby="periksa-h" className="space-y-3">
            <h2 id="periksa-h" className="text-2xl font-bold text-navy">Pemeriksaan dan verifikasi</h2>
            <VerificationPanel verifications={verifications} qrDataUrls={qrs} urls={urls} />
            {highRisk && !openCase && (
              <Card className="space-y-3 border-amber-300 bg-amber-50/60">
                <p className="text-lg font-semibold text-navy">Dokumen ini perlu diajukan sebagai Kasus Hukum Khusus (Special Legal Case)</p>
                <p>Topik dokumen ini berisiko tinggi ({upload!.riskReasons.join(", ").toLowerCase()}). Karena itu, dokumen ini tidak dianalisis AI dan tidak dapat diajukan untuk Legal Review. {SPECIAL_CASE_NOTE}</p>
                <ButtonLink href={`/cases/new?document=${id}`}>Ajukan Special Legal Case</ButtonLink>
              </Card>
            )}
            {openCase && (
              <Card className="space-y-3 border-amber-300 bg-amber-50/60">
                <p className="text-lg font-semibold text-navy">Dokumen ini sedang diajukan sebagai Kasus Hukum Khusus (Special Legal Case)</p>
                <p>Legal Review tidak tersedia selama Special Legal Case untuk dokumen ini masih berjalan. {SPECIAL_CASE_NOTE}</p>
                <ButtonLink href={`/cases/${openCase}`} variant="secondary">Lihat status Special Legal Case</ButtonLink>
              </Card>
            )}
            {reviewable && <ReviewRequestCard versionId={selected.id} active={activeReview} quote={quote} action={requestReviewAction} />}
            {!openCase && !highRisk && (
              <div className="flex flex-wrap items-center gap-x-2 text-muted"><span>Dokumen rumit atau berisiko tinggi dapat diajukan sebagai Kasus Hukum Khusus (Special Legal Case).</span><ButtonLink href={`/cases/new?document=${id}`} variant="quiet" className="!px-0">Ajukan Special Legal Case</ButtonLink></div>
            )}
            <div id="analisis-ai" className="space-y-3">
              {aiStatus && <p role="status" className="rounded-xl border border-line bg-surface p-3 font-semibold">{AI_REVIEW_STATUS_TEXT[aiStatus]}</p>}
              {aiReport && <AiReviewResult report={aiReport.report} completedAt={aiReport.completedAt} verified={aiVerified} />}
              {flags.aiPreReview && !highRisk && (
                <Card>
                  <AiReviewForm action={aiReviewAction} versionId={selected.id} documentId={id} consentText={AI_REVIEW_CONSENT} again={Boolean(aiReport)} />
                </Card>
              )}
            </div>
          </section>

          <details className="rounded-2xl border border-line bg-surface p-4" open={Boolean(packId || q.notice)}>
            <summary className="inline-flex min-h-12 cursor-pointer items-center text-lg font-bold text-navy">Berbagi, pengingat, dan paket bukti</summary>
            <div className="mt-4">
              <VaultPanel
                documentId={id}
                versionId={selected.id}
                features={{ share: fShare, reminders: fRem, evidence: fEvid }}
                shares={shares}
                acks={acks}
                reminderOptions={reminderOptions}
                packId={packId}
                notice={q.notice}
                emailAvailable={ackEmailAvailable()}
                actions={{ createShare: createShareAction, revokeShare: revokeShareAction, setReminder: setReminderAction, cancelReminder: cancelReminderAction, buildPack: buildPackAction }}
              />
            </div>
          </details>

          {!upload && <details className="rounded-2xl border border-line bg-surface p-4">
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
              <VersionList documentId={id} versions={doc.versions} statuses={statuses} />
            </div>
          </details>}
        </>
      )}
    </main>
  );
}

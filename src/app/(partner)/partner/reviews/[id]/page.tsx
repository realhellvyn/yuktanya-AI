import Link from "next/link";
import { notFound } from "next/navigation";
import { DocumentPreview } from "@/components/documents/document-preview";
import { EditorTabs, type EditorPanelId } from "@/components/partner/editor-tabs";
import { PublishPanel } from "@/components/partner/publish-panel";
import { LegalNoteCard } from "@/components/reviews/legal-note-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fieldClass as input, labelText } from "@/components/ui/field";
import { StatusBadge } from "@/components/ui/status-badge";
import { getSessionRoles } from "@/lib/supabase/server";
import { INVALID_FORM_TEXT } from "@/lib/partner/form";
import { categoryLabel } from "@/lib/partner/labels";
import { reviewService } from "@/lib/reviews/runtime";
import { ReviewError } from "@/lib/reviews/service";
import { deleteNoteAction, publishAction, saveDraftAction, upsertNoteAction } from "../../actions";
import { fixedText } from "@/lib/query-text";

export const dynamic = "force-dynamic";
export const metadata = { title: "Review Standar — Editor reviewer | Mitra Hukum Yuktanya" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ERR: Record<string, string> = {
  STALE_REVISION: "Laporan sudah berubah di tab lain. Muat ulang halaman ini lalu ulangi.",
  VERSION_MISMATCH: "Isi versi tidak cocok dengan hash yang dibayar. Penerbitan dihentikan; hubungi koordinator.",
  ATTESTATION_REQUIRED: "Centang pernyataan profesional sebelum menerbitkan.",
  REVIEWER_NOT_AUTHORIZED: "Otorisasi profesional Anda tidak aktif.",
  VALIDATION_FAILED: "Belum memenuhi syarat penerbitan.",
  CONFLICT_ATTESTATION_REQUIRED: "Centang pernyataan tidak ada konflik kepentingan sebelum menerbitkan.",
  CONFLICT_OF_INTEREST: "Firma Anda mencatat konflik kepentingan dengan pemilik dokumen ini. Hasil tidak dapat diterbitkan; hubungi koordinator.",
  INVALID_REQUEST: INVALID_FORM_TEXT,
};
const REASON: Record<string, string> = {
  SCOPE_REQUIRED: "Isi ruang lingkup pemeriksaan.", NOTES_REQUIRED: "Hasil “Dengan Legal Note” memerlukan minimal satu catatan.",
  NOTE_ACTION_REQUIRED: "Catatan yang perlu ditindaklanjuti harus memuat tindakan yang disarankan.",
  NOTE_RATIONALE_REQUIRED: "Catatan Penting/Sangat penting harus memuat tindakan, alasan, dan langkah lanjutan.",
  NOTES_PRESENT: "Hasil “Tanpa Legal Note” tidak boleh memiliki catatan.", NO_NOTES_DECLARATION_REQUIRED: "Centang pernyataan bahwa tidak ada catatan.",
  SUMMARY_REQUIRED: "Isi ringkasan untuk hasil ini.", INVALID_OUTCOME: "Pilih hasil pemeriksaan.",
  REPORT_NOT_CONFIRMED: "Laporan terakhir disimpan reviewer sebelumnya. Periksa lalu tekan Simpan draf.",
  NOTE_NOT_CONFIRMED: "Ada catatan buatan reviewer sebelumnya. Periksa lalu tekan Konfirmasi catatan pada catatan itu.",
};
const OK: Record<string, string> = { draft: "Tersimpan. Laporan sudah diperbarui.", note: "Tersimpan. Daftar catatan sudah diperbarui." };
const H2 = "text-xl font-bold text-navy md:text-2xl";
// Setelah aksi, tab HP kembali ke bagian yang baru dikerjakan.
const tabFor = (q: { e?: string; ok?: string }): EditorPanelId => (q.e ? "hasil" : q.ok === "note" ? "catatan" : q.ok === "draft" ? "pemeriksaan" : "dokumen");

export default async function ReviewEditorPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ e?: string; r?: string; ok?: string; done?: string }> }) {
  const { id } = await params;
  const q = await searchParams;
  const s = (await getSessionRoles())!;
  if (!UUID.test(id) || !s.roles.includes("reviewer")) notFound();
  let review;
  try {
    review = await reviewService().open(s.userId, id);
  } catch (e) {
    if (e instanceof ReviewError) notFound();
    throw e;
  }
  const initial = tabFor(q);
  return (
    <main className="space-y-6">
      <header className="space-y-2">
        <Link href="/partner" className="inline-flex min-h-12 items-center font-semibold text-link underline underline-offset-4">Kembali ke antrean</Link>
        <p className="text-sm font-semibold uppercase tracking-wide text-muted">Review Standar · {categoryLabel(review.category)}</p>
        <h1 className="break-words text-[1.75rem] font-bold leading-tight tracking-tight text-navy md:text-4xl">{review.title}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone="neutral">{`Versi ${review.versionNo} · hanya-baca`}</StatusBadge>
          <span className="break-all font-mono text-sm text-muted" title="Sidik jari SHA-256 versi yang dibayar">SHA-256 {review.sha256.slice(0, 16)}…</span>
        </div>
      </header>
      {q.ok && <p role="status" className="rounded-xl border border-green-300 bg-green-50 p-4 font-semibold text-green-900">{fixedText(OK, q.ok) ?? "Tersimpan."}</p>}
      {q.e && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 font-semibold text-danger">{fixedText(ERR, q.e) ?? "Terjadi kendala."}{fixedText(REASON, q.r) ? ` ${fixedText(REASON, q.r)}` : ""}</p>}

      <EditorTabs key={`${q.ok ?? ""}${q.e ?? ""}${review.revision}`} initial={initial} panels={[
        {
          id: "dokumen", label: "Dokumen", content: (
            <>
              <h2 className={H2}>Isi dokumen yang diperiksa</h2>
              <p className="text-muted">Teks ini adalah versi yang dibayar dan tidak dapat diubah.</p>
              <DocumentPreview doc={review.doc} />
            </>
          ),
        },
        {
          id: "catatan", label: "Catatan", content: (
            <>
              <h2 className={H2}>Legal Note ({review.notes.length})</h2>
              {review.notes.map((n) => (
                <div key={n.noteNo} className="space-y-2">
                  <LegalNoteCard note={n} />
                  {!n.mine && (
                    <form action={upsertNoteAction} className="space-y-2 rounded-xl border border-amber-400 bg-amber-50 p-3 text-amber-950">
                      <p className="font-semibold">Catatan {n.noteNo} dibuat reviewer sebelumnya. Catatan ini baru ikut terbit atas nama Anda setelah Anda memeriksanya dan menekan Konfirmasi.</p>
                      <input type="hidden" name="requestId" value={id} /><input type="hidden" name="revision" value={review.revision} />
                      <input type="hidden" name="noteNo" value={n.noteNo} /><input type="hidden" name="title" value={n.title} />
                      <input type="hidden" name="finding" value={n.finding} /><input type="hidden" name="quote" value={n.quote ?? ""} />
                      <input type="hidden" name="blockId" value={n.blockId ?? ""} /><input type="hidden" name="severity" value={n.severity} />
                      {n.actionable && <input type="hidden" name="actionable" value="yes" />}
                      <input type="hidden" name="recommendedAction" value={n.recommendedAction ?? ""} />
                      <input type="hidden" name="rationale" value={n.rationale ?? ""} /><input type="hidden" name="escalation" value={n.escalation ?? ""} />
                      <Button type="submit" variant="secondary">Konfirmasi catatan {n.noteNo}</Button>
                    </form>
                  )}
                  <form action={deleteNoteAction}>
                    <input type="hidden" name="requestId" value={id} />
                    <input type="hidden" name="revision" value={review.revision} />
                    <input type="hidden" name="noteNo" value={n.noteNo} />
                    <Button type="submit" variant="secondary">Hapus catatan {n.noteNo}</Button>
                  </form>
                </div>
              ))}
              <Card>
                <form action={upsertNoteAction} className="space-y-3">
                  <h3 className="text-lg font-bold text-navy">Tambah catatan</h3>
                  <input type="hidden" name="requestId" value={id} />
                  <input type="hidden" name="revision" value={review.revision} />
                  <label className="block"><span className={labelText}>Judul (Wajib)</span><input name="title" required maxLength={200} className={input} /></label>
                  <label className="block"><span className={labelText}>Temuan (Wajib)</span><textarea name="finding" required rows={3} maxLength={4000} className={input} /></label>
                  <label className="block"><span className={labelText}>Kutipan dari dokumen</span><input name="quote" maxLength={1000} className={input} /></label>
                  <label className="block"><span className={labelText}>Bagian dokumen</span>
                    <select name="blockId" className={input}><option value="">Tidak spesifik</option>{review.doc.blocks.map((b) => <option key={b.id} value={b.id}>{b.id}</option>)}</select>
                  </label>
                  <label className="block"><span className={labelText}>Tingkat</span>
                    <select name="severity" className={input} defaultValue="MINOR"><option value="INFO">Informasi</option><option value="MINOR">Perlu diperhatikan</option><option value="MATERIAL">Penting</option><option value="CRITICAL">Sangat penting</option></select>
                  </label>
                  <label className="flex min-h-12 items-center gap-3"><input type="checkbox" name="actionable" value="yes" className="h-6 w-6 shrink-0" /><span>Perlu ditindaklanjuti pemilik</span></label>
                  <label className="block"><span className={labelText}>Tindakan yang disarankan</span><textarea name="recommendedAction" rows={2} className={input} /></label>
                  <label className="block"><span className={labelText}>Alasan (wajib untuk Penting/Sangat penting)</span><textarea name="rationale" rows={2} className={input} /></label>
                  <label className="block"><span className={labelText}>Langkah lanjutan (wajib untuk Penting/Sangat penting)</span><textarea name="escalation" rows={2} className={input} /></label>
                  <Button type="submit">Simpan catatan</Button>
                </form>
              </Card>
            </>
          ),
        },
        {
          id: "pemeriksaan", label: "Pemeriksaan", content: (
            <>
              <h2 className={H2}>Laporan pemeriksaan</h2>
              {!review.draftMine && review.scope.trim() !== "" && (
                <p role="status" className="rounded-xl border border-amber-400 bg-amber-50 p-3 font-semibold text-amber-950">Isi laporan ini disimpan reviewer sebelumnya. Periksa lalu tekan Simpan draf agar menjadi laporan Anda.</p>
              )}
              <Card>
                <form action={saveDraftAction} className="space-y-3">
                  <input type="hidden" name="requestId" value={id} />
                  <input type="hidden" name="revision" value={review.revision} />
                  <label className="block"><span className={labelText}>Ruang lingkup pemeriksaan (Wajib)</span><textarea name="scope" rows={3} defaultValue={review.scope} className={input} /></label>
                  <label className="block"><span className={labelText}>Asumsi</span><textarea name="assumptions" rows={3} defaultValue={review.assumptions} className={input} /></label>
                  <label className="block"><span className={labelText}>Ringkasan (wajib bila belum dapat disimpulkan atau menolak)</span><textarea name="summary" rows={3} defaultValue={review.summary} className={input} /></label>
                  <Button type="submit" variant="secondary">Simpan draf</Button>
                </form>
              </Card>
            </>
          ),
        },
        {
          id: "hasil", label: "Hasil", content: (
            <>
              <h2 className={H2}>Konfirmasi akhir</h2>
              <p>Anda akan menyelesaikan pemeriksaan versi ini. Setelah diterbitkan, laporan dan catatan tidak dapat diubah.</p>
              <Card>
                <PublishPanel action={publishAction} requestId={id} revision={review.revision} title={review.title} versionNo={review.versionNo} sha256={review.sha256}
                  scope={review.scope} summary={review.summary} authorized={review.authorized} draftMine={review.draftMine}
                  notes={review.notes.map((n) => ({ noteNo: n.noteNo, title: n.title, severity: n.severity, actionable: n.actionable, recommendedAction: n.recommendedAction, rationale: n.rationale, escalation: n.escalation, mine: n.mine }))} />
              </Card>
            </>
          ),
        },
      ]} />
    </main>
  );
}

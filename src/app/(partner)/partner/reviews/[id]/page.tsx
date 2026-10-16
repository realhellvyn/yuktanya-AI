import { notFound } from "next/navigation";
import { DocumentPreview } from "@/components/documents/document-preview";
import { LegalNoteCard } from "@/components/reviews/legal-note-card";
import { getSessionRoles } from "@/lib/supabase/server";
import { reviewService } from "@/lib/reviews/runtime";
import { ReviewError } from "@/lib/reviews/service";
import { deleteNoteAction, publishAction, saveDraftAction, upsertNoteAction } from "../../actions";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ERR: Record<string, string> = {
  STALE_REVISION: "Laporan sudah berubah di tab lain. Muat ulang halaman ini lalu ulangi.",
  VERSION_MISMATCH: "Isi versi tidak cocok dengan hash yang dibayar. Penerbitan dihentikan; hubungi koordinator.",
  ATTESTATION_REQUIRED: "Centang pernyataan profesional sebelum menerbitkan.",
  REVIEWER_NOT_AUTHORIZED: "Otorisasi profesional Anda tidak aktif.",
  VALIDATION_FAILED: "Belum memenuhi syarat penerbitan.",
};
const REASON: Record<string, string> = {
  SCOPE_REQUIRED: "Isi ruang lingkup pemeriksaan.", NOTES_REQUIRED: "Hasil “Dengan Legal Note” memerlukan minimal satu catatan.",
  NOTE_ACTION_REQUIRED: "Catatan yang perlu ditindaklanjuti harus memuat tindakan yang disarankan.",
  NOTE_RATIONALE_REQUIRED: "Catatan Penting/Sangat penting harus memuat tindakan, alasan, dan langkah lanjutan.",
  NOTES_PRESENT: "Hasil “Tanpa Legal Note” tidak boleh memiliki catatan.", NO_NOTES_DECLARATION_REQUIRED: "Centang pernyataan bahwa tidak ada catatan.",
  SUMMARY_REQUIRED: "Isi ringkasan untuk hasil ini.", INVALID_OUTCOME: "Pilih hasil pemeriksaan.",
};
const input = "mt-1 block w-full rounded-lg border border-slate-400 px-3 py-2";
const btn = "min-h-12 rounded-lg px-5 font-semibold";

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
  const hasMaterial = review.notes.some((n) => n.severity === "MATERIAL" || n.severity === "CRITICAL");
  const blockers: string[] = [];
  if (review.scope.trim() === "") blockers.push("Isi ruang lingkup pemeriksaan dan simpan draf.");
  return (
    <main className="mx-auto max-w-4xl space-y-8 p-6">
      <h1 className="text-3xl font-semibold">{review.title}</h1>
      {q.done && <p role="status" className="rounded-lg border border-slate-300 bg-white p-4">Pemeriksaan diselesaikan dengan hasil: {q.done}.</p>}
      {q.ok && <p role="status" className="rounded-lg border border-slate-300 bg-white p-3">Tersimpan.</p>}
      {q.e && <p role="alert" className="font-semibold text-red-800">{ERR[q.e] ?? "Terjadi kendala."}{q.r && REASON[q.r] ? ` ${REASON[q.r]}` : ""}</p>}

      <section aria-labelledby="isi-h" className="space-y-3">
        <h2 id="isi-h" className="text-2xl font-semibold">Isi dokumen yang diperiksa</h2>
        <DocumentPreview doc={review.doc} />
      </section>

      <section aria-labelledby="draf-h" className="space-y-3">
        <h2 id="draf-h" className="text-2xl font-semibold">Laporan</h2>
        <form action={saveDraftAction} className="space-y-3">
          <input type="hidden" name="requestId" value={id} />
          <input type="hidden" name="revision" value={review.revision} />
          <label className="block"><span className="font-medium">Ruang lingkup pemeriksaan (Wajib)</span><textarea name="scope" rows={3} defaultValue={review.scope} className={input} /></label>
          <label className="block"><span className="font-medium">Asumsi</span><textarea name="assumptions" rows={3} defaultValue={review.assumptions} className={input} /></label>
          <label className="block"><span className="font-medium">Ringkasan (wajib bila belum dapat disimpulkan atau menolak)</span><textarea name="summary" rows={3} defaultValue={review.summary} className={input} /></label>
          <button type="submit" className={`${btn} border border-slate-400 bg-white`}>Simpan draf</button>
        </form>
      </section>

      <section aria-labelledby="catatan-h" className="space-y-4">
        <h2 id="catatan-h" className="text-2xl font-semibold">Legal Note ({review.notes.length})</h2>
        {review.notes.map((n) => (
          <div key={n.noteNo} className="space-y-2">
            <LegalNoteCard note={n} />
            <form action={deleteNoteAction}>
              <input type="hidden" name="requestId" value={id} />
              <input type="hidden" name="revision" value={review.revision} />
              <input type="hidden" name="noteNo" value={n.noteNo} />
              <button type="submit" className={`${btn} border border-slate-400 bg-white`}>Hapus catatan {n.noteNo}</button>
            </form>
          </div>
        ))}
        <form action={upsertNoteAction} className="space-y-3 rounded-lg border border-slate-300 bg-white p-4">
          <h3 className="text-lg font-semibold">Tambah catatan</h3>
          <input type="hidden" name="requestId" value={id} />
          <input type="hidden" name="revision" value={review.revision} />
          <label className="block"><span className="font-medium">Judul (Wajib)</span><input name="title" required maxLength={200} className={input} /></label>
          <label className="block"><span className="font-medium">Temuan (Wajib)</span><textarea name="finding" required rows={3} maxLength={4000} className={input} /></label>
          <label className="block"><span className="font-medium">Kutipan dari dokumen</span><input name="quote" maxLength={1000} className={input} /></label>
          <label className="block"><span className="font-medium">Bagian dokumen</span>
            <select name="blockId" className={input}><option value="">Tidak spesifik</option>{review.doc.blocks.map((b) => <option key={b.id} value={b.id}>{b.id}</option>)}</select>
          </label>
          <label className="block"><span className="font-medium">Tingkat</span>
            <select name="severity" className={input} defaultValue="MINOR"><option value="INFO">Informasi</option><option value="MINOR">Perlu diperhatikan</option><option value="MATERIAL">Penting</option><option value="CRITICAL">Sangat penting</option></select>
          </label>
          <label className="flex min-h-12 items-center gap-3"><input type="checkbox" name="actionable" value="yes" className="h-6 w-6" /><span>Perlu ditindaklanjuti pemilik</span></label>
          <label className="block"><span className="font-medium">Tindakan yang disarankan</span><textarea name="recommendedAction" rows={2} className={input} /></label>
          <label className="block"><span className="font-medium">Alasan (wajib untuk Penting/Sangat penting)</span><textarea name="rationale" rows={2} className={input} /></label>
          <label className="block"><span className="font-medium">Langkah lanjutan (wajib untuk Penting/Sangat penting)</span><textarea name="escalation" rows={2} className={input} /></label>
          <button type="submit" className={`${btn} bg-blue-600 text-white`}>Simpan catatan</button>
        </form>
      </section>

      <section aria-labelledby="terbit-h" className="space-y-3 rounded-lg border border-slate-300 bg-white p-4">
        <h2 id="terbit-h" className="text-2xl font-semibold">Konfirmasi akhir</h2>
        <p>Anda akan menyelesaikan pemeriksaan versi ini. Setelah diterbitkan, laporan dan catatan tidak dapat diubah.</p>
        <ul className="list-disc space-y-1 pl-6">
          <li>Ruang lingkup: {review.scope.trim() || "(belum diisi)"}</li>
          <li>Jumlah catatan tersisa: {review.notes.length}{hasMaterial ? " (ada yang Penting atau Sangat penting)" : ""}</li>
        </ul>
        {blockers.length > 0 && <ul role="status" className="list-disc pl-6 font-medium">{blockers.map((b) => <li key={b}>{b}</li>)}</ul>}
        <form action={publishAction} className="space-y-3">
          <input type="hidden" name="requestId" value={id} />
          <input type="hidden" name="revision" value={review.revision} />
          <label className="block"><span className="font-medium">Hasil pemeriksaan</span>
            <select name="outcome" className={input} defaultValue={review.notes.length > 0 ? "WITH_NOTES" : "WITHIN_SCOPE"}>
              <option value="WITH_NOTES">Selesai — Dengan Legal Note</option>
              <option value="WITHIN_SCOPE">Selesai — Tanpa Legal Note, sesuai lingkup</option>
              <option value="INCONCLUSIVE">Belum dapat disimpulkan (tanpa verifikasi)</option>
              <option value="DECLINED">Tidak dapat memeriksa (tanpa verifikasi)</option>
            </select>
          </label>
          <label className="flex min-h-12 items-center gap-3"><input type="checkbox" name="noNotesDeclared" value="yes" className="h-6 w-6" /><span>Saya menyatakan tidak ada catatan yang tersisa dan kriteria terpenuhi dalam lingkup ini.</span></label>
          <label className="flex min-h-12 items-start gap-3"><input type="checkbox" name="attest" value="yes" className="mt-1 h-6 w-6" /><span>Saya menyatakan bahwa saya profesional yang berwenang dan telah memeriksa versi ini sendiri sesuai ruang lingkup di atas.</span></label>
          <button type="submit" disabled={blockers.length > 0} className={`${btn} bg-blue-600 text-white disabled:opacity-50`}>Terbitkan hasil</button>
        </form>
      </section>
    </main>
  );
}

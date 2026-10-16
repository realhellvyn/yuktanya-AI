import { notFound } from "next/navigation";
import { DocumentPreview } from "@/components/documents/document-preview";
import { deepService } from "@/lib/deep/runtime";
import { flags } from "@/lib/flags";
import { ReviewError } from "@/lib/reviews/service";
import { getSessionRoles } from "@/lib/supabase/server";
import { decideDeepAction, saveDeepDraftAction, setChecklistAction, setDispositionAction } from "../../deep-actions";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ERR: Record<string, string> = {
  STALE_REVISION: "Laporan sudah berubah di tab lain. Muat ulang halaman ini lalu ulangi.", VERSION_MISMATCH: "Isi versi tidak cocok dengan hash yang dibayar. Hentikan dan hubungi koordinator.",
  ATTESTATION_REQUIRED: "Centang pernyataan profesional sebelum memutuskan.", REVIEWER_NOT_AUTHORIZED: "Otorisasi profesional Anda tidak aktif.", ENHANCED_DISABLED: "Penerbitan Enhanced belum diaktifkan. Pilih keputusan lain atau tunggu aktivasi.",
  VALIDATION_FAILED: "Belum memenuhi syarat keputusan.",
};
const REASON: Record<string, string> = {
  REVOKED_PARENT: "Verifikasi pemeriksaan standar sudah dicabut atau ditangguhkan.", PAYMENT_NOT_VERIFIED: "Pembayaran belum terverifikasi.", NO_EXTRA_WORK: "Catat pekerjaan tambahan yang Anda lakukan.",
  UNAPPROVED_RUBRIC: "Rubrik material belum disetujui mitra. Enhanced tidak dapat diterbitkan.", CHECKLIST_INCOMPLETE: "Isi ketujuh butir checklist M1–M7.",
  MATERIAL_FAIL: "Ada butir checklist yang GAGAL. Enhanced tidak dapat diterbitkan.", MATERIAL_UNKNOWN: "Ada butir checklist yang BELUM DIKETAHUI. Enhanced tidak dapat diterbitkan.",
  MISSING_EVIDENCE: "Setiap butir LULUS wajib memiliki bukti; N/A wajib beralasan.", DISPOSITION_MISSING: "Beri tindak lanjut untuk setiap catatan yang perlu ditindaklanjuti.",
  UNRESOLVED_MATERIAL_NOTE: "Catatan Penting/Sangat penting harus berstatus sudah diselesaikan.", REASON_REQUIRED: "Isi alasan keputusan.", MANDATORY_ITEM: "Butir M4, M6, dan M7 wajib dan tidak boleh N/A.",
};
const ITEMS: Record<string, string> = {
  M1: "Para pihak, kapasitas, dan kewenangan", M2: "Isi perjanjian dan kewajiban pokok jelas dan konsisten", M3: "Tidak ada ketidakabsahan atau tujuan terlarang yang material",
  M4: "Risiko dari Legal Note standar sudah ditangani (wajib)", M5: "Formalitas atau tindakan profesional khusus sudah dinilai", M6: "Pekerjaan tambahan lengkap dan bukti cukup (wajib)", M7: "Artefak, kewenangan, konflik, ruang lingkup, dan pernyataan terkonfirmasi (wajib)",
};
const input = "mt-1 block min-h-12 w-full rounded-lg border border-slate-400 px-3 py-2";
const btn = "min-h-12 rounded-lg px-5 font-semibold";

export default async function DeepEditorPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ e?: string; r?: string; ok?: string }> }) {
  const { id } = await params;
  const q = await searchParams;
  const s = (await getSessionRoles())!;
  if (!UUID.test(id) || !s.roles.includes("reviewer")) notFound();
  let d;
  try {
    d = await deepService().open(s.userId, id);
  } catch (e) {
    if (e instanceof ReviewError) notFound();
    throw e;
  }
  const chk = new Map(d.checklist.map((c) => [c.item, c]));
  const disp = new Map(d.dispositions.map((x) => [x.noteNo, x]));
  return (
    <main className="mx-auto max-w-4xl space-y-8 p-6">
      <h1 className="text-3xl font-semibold">Pemeriksaan mendalam — {d.title}</h1>
      {q.ok && <p role="status" className="rounded-lg border border-line bg-white p-3">Tersimpan.</p>}
      {q.e && <p role="alert" className="font-semibold text-danger">{ERR[q.e] ?? "Terjadi kendala."}{q.r && REASON[q.r] ? ` ${REASON[q.r]}` : ""}</p>}
      <section aria-labelledby="isi-h" className="space-y-3"><h2 id="isi-h" className="text-2xl font-semibold">Isi dokumen yang diperiksa</h2><DocumentPreview doc={d.doc} /></section>

      <section aria-labelledby="draf-h" className="space-y-3">
        <h2 id="draf-h" className="text-2xl font-semibold">Pekerjaan tambahan</h2>
        <form action={saveDeepDraftAction} className="space-y-3">
          <input type="hidden" name="deepId" value={id} /><input type="hidden" name="revision" value={d.revision} />
          <label className="block"><span className="font-medium">Pekerjaan tambahan yang dilakukan (Wajib untuk Enhanced)</span><textarea name="extraWork" rows={4} defaultValue={d.extraWork} className={input} /></label>
          <label className="block"><span className="font-medium">Ringkasan</span><textarea name="summary" rows={3} defaultValue={d.summary} className={input} /></label>
          <button type="submit" className={`${btn} border border-slate-400 bg-white`}>Simpan</button>
        </form>
      </section>

      <section aria-labelledby="cat-h" className="space-y-4">
        <h2 id="cat-h" className="text-2xl font-semibold">Tindak lanjut catatan pemeriksaan standar</h2>
        {d.parentNotes.map((n) => (
          <form key={n.noteNo} action={setDispositionAction} className="space-y-2 rounded-lg border border-line bg-white p-4">
            <input type="hidden" name="deepId" value={id} /><input type="hidden" name="revision" value={d.revision} /><input type="hidden" name="noteNo" value={n.noteNo} />
            <p className="font-semibold">Catatan {n.noteNo}: {n.title} ({n.severity === "CRITICAL" ? "Sangat penting" : n.severity === "MATERIAL" ? "Penting" : n.severity === "MINOR" ? "Perlu diperhatikan" : "Informasi"})</p>
            <p>{n.finding}</p>
            <label className="block"><span className="font-medium">Status</span>
              <select name="disposition" defaultValue={disp.get(n.noteNo)?.disposition ?? "RESOLVED"} className={input}>
                <option value="RESOLVED">Sudah diselesaikan</option><option value="ACCEPTED_RISK">Risiko diterima</option><option value="UNRESOLVED">Belum diselesaikan</option><option value="OUT_OF_SCOPE">Di luar ruang lingkup</option>
              </select>
            </label>
            <label className="block"><span className="font-medium">Bukti atau sumber</span><input name="evidence" defaultValue={disp.get(n.noteNo)?.evidence ?? ""} className={input} /></label>
            <button type="submit" className={`${btn} border border-slate-400 bg-white`}>Simpan tindak lanjut</button>
          </form>
        ))}
      </section>

      <section aria-labelledby="chk-h" className="space-y-4">
        <h2 id="chk-h" className="text-2xl font-semibold">Checklist material (usulan, menunggu persetujuan mitra)</h2>
        {Object.entries(ITEMS).map(([item, label]) => (
          <form key={item} action={setChecklistAction} className="space-y-2 rounded-lg border border-line bg-white p-4">
            <input type="hidden" name="deepId" value={id} /><input type="hidden" name="revision" value={d.revision} /><input type="hidden" name="item" value={item} />
            <p className="font-semibold">{item} — {label}</p>
            <label className="block"><span className="font-medium">Hasil</span>
              <select name="result" defaultValue={chk.get(item)?.result ?? "UNKNOWN"} className={input}>
                <option value="PASS">Lulus</option><option value="FAIL">Gagal</option><option value="UNKNOWN">Belum diketahui</option>{!["M4", "M6", "M7"].includes(item) && <option value="N_A">Tidak berlaku</option>}
              </select>
            </label>
            <label className="block"><span className="font-medium">Alasan</span><textarea name="reasoning" rows={2} defaultValue={chk.get(item)?.reasoning ?? ""} className={input} /></label>
            <label className="block"><span className="font-medium">Bukti (wajib bila Lulus)</span><input name="evidenceRef" defaultValue={chk.get(item)?.evidenceRef ?? ""} className={input} /></label>
            <button type="submit" className={`${btn} border border-slate-400 bg-white`}>Simpan {item}</button>
          </form>
        ))}
      </section>

      <section aria-labelledby="putus-h" className="space-y-3 rounded-lg border border-line bg-white p-4">
        <h2 id="putus-h" className="text-2xl font-semibold">Keputusan akhir</h2>
        <p>Pembayaran tidak menjamin hasil apa pun. Enhanced hanya terbit bila semua syarat terpenuhi dan Anda menyetujui secara eksplisit. Keputusan tidak dapat diubah setelah disimpan.</p>
        {!flags.enhancedIssuance && <p role="status" className="font-medium">Penerbitan Enhanced belum diaktifkan. Anda masih dapat memilih keputusan lain.</p>}
        <form action={decideDeepAction} className="space-y-3">
          <input type="hidden" name="deepId" value={id} /><input type="hidden" name="revision" value={d.revision} />
          <label className="block"><span className="font-medium">Keputusan</span>
            <select name="decision" className={input} defaultValue="DENY">
              <option value="APPROVE">Setujui Enhanced</option><option value="DENY">Selesai dengan catatan (tanpa Enhanced)</option>
              <option value="INCONCLUSIVE">Belum dapat disimpulkan</option><option value="REFER_SPECIAL">Rujuk sebagai kasus khusus</option>
            </select>
          </label>
          <label className="block"><span className="font-medium">Alasan (wajib selain Setujui)</span><textarea name="reason" rows={3} className={input} /></label>
          <label className="flex min-h-12 items-start gap-3"><input type="checkbox" name="attest" value="yes" className="mt-1 h-6 w-6" /><span>Saya menyatakan bahwa saya profesional yang berwenang dan telah melakukan pemeriksaan tambahan ini sendiri.</span></label>
          <button type="submit" className={`${btn} bg-brand hover:bg-brand-dark text-white`}>Simpan keputusan</button>
        </form>
      </section>
    </main>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { DocumentPreview } from "@/components/documents/document-preview";
import { DecisionPanel } from "@/components/partner/decision-panel";
import { EditorTabs, type EditorPanelId } from "@/components/partner/editor-tabs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fieldClass as input, labelText } from "@/components/ui/field";
import { StatusBadge } from "@/components/ui/status-badge";
import { deepService } from "@/lib/deep/runtime";
import { flags } from "@/lib/flags";
import { categoryLabel, SEVERITY } from "@/lib/partner/labels";
import { INVALID_FORM_TEXT } from "@/lib/partner/form";
import { deepConfirmBlockers, enhancedBlockers } from "@/lib/partner/readiness";
import { ReviewError } from "@/lib/reviews/service";
import { getSessionRoles } from "@/lib/supabase/server";
import { decideDeepAction, saveDeepDraftAction, setChecklistAction, setDispositionAction } from "../../deep-actions";
import { fixedText } from "@/lib/query-text";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pemeriksaan Mendalam — Editor reviewer | Mitra Hukum Yuktanya" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ERR: Record<string, string> = {
  STALE_REVISION: "Laporan sudah berubah di tab lain. Muat ulang halaman ini lalu ulangi.", VERSION_MISMATCH: "Isi versi tidak cocok dengan hash yang dibayar. Hentikan dan hubungi koordinator.",
  ATTESTATION_REQUIRED: "Centang pernyataan profesional sebelum memutuskan.", REVIEWER_NOT_AUTHORIZED: "Otorisasi profesional Anda tidak aktif.", ENHANCED_DISABLED: "Penerbitan Enhanced belum diaktifkan. Pilih keputusan lain atau tunggu aktivasi.",
  VALIDATION_FAILED: "Belum memenuhi syarat keputusan.",
  CONFLICT_ATTESTATION_REQUIRED: "Centang pernyataan tidak ada konflik kepentingan sebelum memutuskan.",
  CONFLICT_OF_INTEREST: "Firma Anda mencatat konflik kepentingan dengan pemilik dokumen ini. Keputusan tidak dapat disimpan; hubungi koordinator.",
  INVALID_REQUEST: INVALID_FORM_TEXT,
};
const REASON: Record<string, string> = {
  REVOKED_PARENT: "Verifikasi pemeriksaan standar sudah dicabut atau ditangguhkan.", PAYMENT_NOT_VERIFIED: "Pembayaran belum terverifikasi.", NO_EXTRA_WORK: "Catat pekerjaan tambahan yang Anda lakukan.",
  UNAPPROVED_RUBRIC: "Rubrik material belum disetujui mitra. Enhanced tidak dapat diterbitkan.", CHECKLIST_INCOMPLETE: "Isi ketujuh butir checklist M1–M7.",
  MATERIAL_FAIL: "Ada butir checklist yang GAGAL. Enhanced tidak dapat diterbitkan.", MATERIAL_UNKNOWN: "Ada butir checklist yang BELUM DIKETAHUI. Enhanced tidak dapat diterbitkan.",
  MISSING_EVIDENCE: "Setiap butir LULUS wajib memiliki bukti; N/A wajib beralasan.", DISPOSITION_MISSING: "Beri tindak lanjut untuk setiap catatan yang perlu ditindaklanjuti.",
  UNRESOLVED_MATERIAL_NOTE: "Catatan Penting/Sangat penting harus berstatus sudah diselesaikan.", REASON_REQUIRED: "Isi alasan keputusan.", MANDATORY_ITEM: "Butir M4, M6, dan M7 wajib dan tidak boleh N/A.",
  REPORT_NOT_CONFIRMED: "Pekerjaan tambahan disimpan reviewer sebelumnya. Periksa lalu simpan ulang.",
  DISPOSITION_NOT_CONFIRMED: "Ada tindak lanjut catatan yang diisi reviewer sebelumnya. Periksa lalu simpan ulang.",
  CHECKLIST_NOT_CONFIRMED: "Ada butir checklist yang diisi reviewer sebelumnya. Periksa lalu simpan ulang setiap butir.",
};
const PREVIOUS = "Diisi reviewer sebelumnya. Periksa lalu simpan ulang agar dihitung atas nama Anda.";
const ITEMS: Record<string, string> = {
  M1: "Para pihak, kapasitas, dan kewenangan", M2: "Isi perjanjian dan kewajiban pokok jelas dan konsisten", M3: "Tidak ada ketidakabsahan atau tujuan terlarang yang material",
  M4: "Risiko dari Legal Note standar sudah ditangani (wajib)", M5: "Formalitas atau tindakan profesional khusus sudah dinilai", M6: "Pekerjaan tambahan lengkap dan bukti cukup (wajib)", M7: "Artefak, kewenangan, konflik, ruang lingkup, dan pernyataan terkonfirmasi (wajib)",
};
const DISPOSITION: Record<string, string> = { RESOLVED: "Sudah diselesaikan", ACCEPTED_RISK: "Risiko diterima", UNRESOLVED: "Belum diselesaikan", OUT_OF_SCOPE: "Di luar ruang lingkup" };
const RESULT: Record<string, string> = { PASS: "Lulus", FAIL: "Gagal", UNKNOWN: "Belum diketahui", N_A: "Tidak berlaku" };
const H2 = "text-xl font-bold text-navy md:text-2xl";
const tabFor = (q: { e?: string; ok?: string }): EditorPanelId => (q.e ? "hasil" : q.ok === "disp" ? "catatan" : q.ok === "chk" || q.ok === "draft" ? "pemeriksaan" : "dokumen");

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
  const state = { opened: true, authorized: d.authorized, extraWork: d.extraWork, checklist: d.checklist, dispositions: d.dispositions, parentNotes: d.parentNotes, draftMine: d.draftMine };
  const approveBlockers = enhancedBlockers(state, { rubricApproved: d.rubricApproved, enabled: flags.enhancedIssuance });
  // Keputusan selain Setujui: pekerjaan tambahan dan tindak lanjut tampil ke pemilik, jadi wajib milik pemutus juga.
  const confirmBlockers = deepConfirmBlockers({ ...state, checklist: [] });
  const unresolved = d.parentNotes
    .filter((n) => disp.get(n.noteNo)?.disposition !== "RESOLVED")
    .map((n) => `Catatan ${n.noteNo}: ${n.title} — ${disp.has(n.noteNo) ? DISPOSITION[disp.get(n.noteNo)!.disposition] : "belum ada tindak lanjut"}`);
  return (
    <main className="space-y-6">
      <header className="space-y-2">
        <Link href="/partner" className="inline-flex min-h-12 items-center font-semibold text-link underline underline-offset-4">Kembali ke antrean</Link>
        <p className="text-sm font-semibold uppercase tracking-wide text-muted">Pemeriksaan Mendalam · {categoryLabel(d.category)}</p>
        <h1 className="break-words text-[1.75rem] font-bold leading-tight tracking-tight text-navy md:text-4xl">Pemeriksaan mendalam — {d.title}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone="neutral">{`Versi ${d.versionNo} · hanya-baca`}</StatusBadge>
          <span className="break-all font-mono text-sm text-muted" title="Sidik jari SHA-256 versi yang dibayar">SHA-256 {d.sha256.slice(0, 16)}…</span>
        </div>
      </header>
      {q.ok && <p role="status" className="rounded-xl border border-green-300 bg-green-50 p-4 font-semibold text-green-900">Tersimpan.</p>}
      {q.e && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 font-semibold text-danger">{fixedText(ERR, q.e) ?? "Terjadi kendala."}{fixedText(REASON, q.r) ? ` ${fixedText(REASON, q.r)}` : ""}</p>}

      <EditorTabs key={`${q.ok ?? ""}${q.e ?? ""}${d.revision}`} initial={tabFor(q)} panels={[
        {
          id: "dokumen", label: "Dokumen", content: (
            <>
              <h2 className={H2}>Isi dokumen yang diperiksa</h2>
              <p className="text-muted">Teks ini adalah versi yang sama dengan Review Standar dan tidak dapat diubah.</p>
              <DocumentPreview doc={d.doc} />
            </>
          ),
        },
        {
          id: "catatan", label: "Catatan", content: (
            <>
              <h2 className={H2}>Tindak lanjut catatan pemeriksaan standar</h2>
              {d.parentNotes.length === 0 && <p>Tidak ada catatan dari pemeriksaan standar.</p>}
              {d.parentNotes.map((n) => (
                <Card key={n.noteNo}>
                  <form action={setDispositionAction} className="space-y-3">
                    <input type="hidden" name="deepId" value={id} /><input type="hidden" name="revision" value={d.revision} /><input type="hidden" name="noteNo" value={n.noteNo} />
                    <p className="break-words font-semibold text-navy">Catatan {n.noteNo}: {n.title} ({SEVERITY[n.severity] ?? n.severity})</p>
                    <p className="break-words">{n.finding}</p>
                    {disp.get(n.noteNo)?.mine === false && <p role="status" className="font-semibold text-amber-950">{PREVIOUS}</p>}
                    <label className="block"><span className={labelText}>Status</span>
                      <select name="disposition" defaultValue={disp.get(n.noteNo)?.disposition ?? "RESOLVED"} className={input}>
                        {Object.entries(DISPOSITION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </label>
                    <label className="block"><span className={labelText}>Bukti atau sumber</span><input name="evidence" defaultValue={disp.get(n.noteNo)?.evidence ?? ""} className={input} /></label>
                    <Button type="submit" variant="secondary">Simpan tindak lanjut</Button>
                  </form>
                </Card>
              ))}
            </>
          ),
        },
        {
          id: "pemeriksaan", label: "Pemeriksaan", content: (
            <>
              <h2 className={H2}>Pekerjaan tambahan</h2>
              <Card>
                <form action={saveDeepDraftAction} className="space-y-3">
                  <input type="hidden" name="deepId" value={id} /><input type="hidden" name="revision" value={d.revision} />
                  {!d.draftMine && d.extraWork.trim() !== "" && <p role="status" className="font-semibold text-amber-950">{PREVIOUS}</p>}
                  <label className="block"><span className={labelText}>Pekerjaan tambahan yang dilakukan (Wajib untuk Enhanced)</span><textarea name="extraWork" rows={4} defaultValue={d.extraWork} className={input} /></label>
                  <label className="block"><span className={labelText}>Ringkasan</span><textarea name="summary" rows={3} defaultValue={d.summary} className={input} /></label>
                  <Button type="submit" variant="secondary">Simpan pekerjaan tambahan</Button>
                </form>
              </Card>
              <h2 className={H2}>Checklist material (usulan, menunggu persetujuan mitra)</h2>
              {Object.entries(ITEMS).map(([item, label]) => (
                <Card key={item}>
                  <form action={setChecklistAction} className="space-y-3">
                    <input type="hidden" name="deepId" value={id} /><input type="hidden" name="revision" value={d.revision} /><input type="hidden" name="item" value={item} />
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="min-w-0 break-words font-semibold text-navy">{item} — {label}</p>
                      <StatusBadge tone={chk.get(item)?.result === "PASS" ? "success" : chk.get(item)?.result === "FAIL" ? "danger" : "neutral"}>{chk.has(item) ? RESULT[chk.get(item)!.result] ?? chk.get(item)!.result : "Belum diisi"}</StatusBadge>
                    </div>
                    {chk.get(item)?.mine === false && <p role="status" className="font-semibold text-amber-950">{PREVIOUS}</p>}
                    <label className="block"><span className={labelText}>Hasil</span>
                      <select name="result" defaultValue={chk.get(item)?.result ?? "UNKNOWN"} className={input}>
                        <option value="PASS">Lulus</option><option value="FAIL">Gagal</option><option value="UNKNOWN">Belum diketahui</option>{!["M4", "M6", "M7"].includes(item) && <option value="N_A">Tidak berlaku</option>}
                      </select>
                    </label>
                    <label className="block"><span className={labelText}>Alasan</span><textarea name="reasoning" rows={2} defaultValue={chk.get(item)?.reasoning ?? ""} className={input} /></label>
                    <label className="block"><span className={labelText}>Bukti (wajib bila Lulus)</span><input name="evidenceRef" defaultValue={chk.get(item)?.evidenceRef ?? ""} className={input} /></label>
                    <Button type="submit" variant="secondary">Simpan {item}</Button>
                  </form>
                </Card>
              ))}
            </>
          ),
        },
        {
          id: "hasil", label: "Hasil", content: (
            <>
              <h2 className={H2}>Keputusan akhir</h2>
              <p>Pembayaran tidak menjamin hasil apa pun. Enhanced hanya terbit bila semua syarat terpenuhi dan Anda menyetujui secara eksplisit. Keputusan tidak dapat diubah setelah disimpan.</p>
              {!flags.enhancedIssuance && <p role="status" className="font-semibold">Penerbitan Enhanced belum diaktifkan. Anda masih dapat memilih keputusan lain.</p>}
              <Card>
                <DecisionPanel action={decideDeepAction} deepId={id} revision={d.revision} title={d.title} versionNo={d.versionNo} sha256={d.sha256}
                  parentScope={d.parentScope} approveBlockers={approveBlockers} confirmBlockers={confirmBlockers} unresolved={unresolved} authorized={d.authorized} />
              </Card>
            </>
          ),
        },
      ]} />
    </main>
  );
}

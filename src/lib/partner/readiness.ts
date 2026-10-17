// Kesiapan keputusan akhir reviewer. Ini hanya penjelasan untuk tampilan; database tetap penentu (publish_standard, decide_deep).

export type StandardOutcome = "WITH_NOTES" | "WITHIN_SCOPE" | "INCONCLUSIVE" | "DECLINED";
// mine === false: baris disimpan dalam penugasan lain (reviewer sebelumnya) dan tidak dihitung sampai disimpan ulang.
// Tidak diisi (undefined) dianggap milik sendiri, untuk tampilan yang tidak memuat penulis.
export type NoteLite = {
  noteNo: number; severity: string; actionable: boolean;
  recommendedAction?: string | null; rationale?: string | null; escalation?: string | null; mine?: boolean;
};
export type StandardState = { opened: boolean; authorized: boolean; scope: string; summary: string; notes: NoteLite[]; draftMine?: boolean };
export type ChecklistLite = { item: string; result: string; reasoning: string; evidenceRef: string; mine?: boolean };
export type DispositionLite = { noteNo: number; disposition: string; evidence: string; mine?: boolean };
export type DeepState = {
  opened: boolean; authorized: boolean; extraWork: string; checklist: ChecklistLite[]; dispositions: DispositionLite[];
  parentNotes: { noteNo: number; severity: string; actionable: boolean }[]; draftMine?: boolean;
};
export type Readiness = { ready: boolean; reasons: string[] };

export const CHECKLIST_ITEMS = ["M1", "M2", "M3", "M4", "M5", "M6", "M7"] as const;
const blank = (s: string | null | undefined) => !s || s.trim() === "";
const isMaterial = (severity: string) => severity === "MATERIAL" || severity === "CRITICAL";
const NOT_OPENED = "Pekerjaan ini belum dibuka. Buka pekerjaan untuk mulai memeriksa.";
const NOT_AUTHORIZED = "Otorisasi profesional Anda tidak aktif. Hubungi koordinator.";

// Cermin B-01 di publish_standard / decide_deep: isi buatan reviewer sebelumnya wajib diperiksa lalu disimpan ulang.
export function standardConfirmBlockers(s: Pick<StandardState, "scope" | "notes" | "draftMine">): string[] {
  const out: string[] = [];
  if (s.draftMine === false && !blank(s.scope)) out.push("Laporan diisi pemeriksa sebelumnya. Periksa isinya, lalu tekan Simpan draf.");
  const others = s.notes.filter((n) => n.mine === false).map((n) => n.noteNo);
  if (others.length) out.push(`Catatan ${others.join(", ")} dibuat pemeriksa sebelumnya. Periksa catatan tersebut, lalu tekan Konfirmasi catatan.`);
  return out;
}
export function deepConfirmBlockers(d: Pick<DeepState, "extraWork" | "checklist" | "dispositions" | "draftMine">): string[] {
  const out: string[] = [];
  if (d.draftMine === false && !blank(d.extraWork)) out.push("Pekerjaan tambahan diisi pemeriksa sebelumnya. Periksa isinya, lalu simpan ulang.");
  const disp = d.dispositions.filter((x) => x.mine === false).map((x) => x.noteNo);
  if (disp.length) out.push(`Tindak lanjut catatan ${disp.join(", ")} diisi pemeriksa sebelumnya. Periksa isinya, lalu simpan ulang.`);
  const chk = d.checklist.filter((c) => c.mine === false).map((c) => c.item).sort();
  if (chk.length) out.push(`Butir ${chk.join(", ")} diisi pemeriksa sebelumnya. Periksa isinya, lalu simpan ulang.`);
  return out;
}

export function standardOutcomeBlockers(s: Pick<StandardState, "scope" | "summary" | "notes" | "draftMine">, outcome: StandardOutcome): string[] {
  const out: string[] = [];
  if (blank(s.scope)) out.push("Isi ruang lingkup pemeriksaan, lalu simpan.");
  if (outcome === "WITH_NOTES") {
    if (s.notes.length === 0) out.push("Tambahkan minimal satu Legal Note, atau pilih hasil tanpa Legal Note.");
    for (const n of s.notes) {
      if (isMaterial(n.severity) && (blank(n.recommendedAction) || blank(n.rationale) || blank(n.escalation))) {
        out.push(`Catatan ${n.noteNo}: isi tindakan, alasan, dan langkah lanjutan.`);
      } else if (n.actionable && blank(n.recommendedAction)) {
        out.push(`Catatan ${n.noteNo}: isi tindakan yang disarankan.`);
      }
    }
  } else if (outcome === "WITHIN_SCOPE") {
    if (s.notes.length > 0) out.push("Hapus semua catatan untuk memilih hasil tanpa Legal Note.");
  } else if (blank(s.summary)) {
    out.push("Isi ringkasan untuk hasil ini, lalu simpan.");
  }
  out.push(...standardConfirmBlockers(s));
  return out;
}

// Siap = hasil yang wajar (Dengan Legal Note bila ada catatan, selain itu Tanpa Legal Note) dapat diterbitkan sekarang.
export function standardReadiness(s: StandardState): Readiness {
  const reasons: string[] = [];
  if (!s.opened) reasons.push(NOT_OPENED);
  if (!s.authorized) reasons.push(NOT_AUTHORIZED);
  reasons.push(...standardOutcomeBlockers(s, s.notes.length > 0 ? "WITH_NOTES" : "WITHIN_SCOPE"));
  return { ready: reasons.length === 0, reasons };
}

// Siap diputuskan = pekerjaan tambahan dicatat, checklist M1–M7 lengkap (tanpa "Belum diketahui"), bukti dan tindak lanjut terisi.
export function deepReadiness(d: DeepState): Readiness {
  const reasons: string[] = [];
  if (!d.opened) reasons.push(NOT_OPENED);
  if (!d.authorized) reasons.push(NOT_AUTHORIZED);
  if (blank(d.extraWork)) reasons.push("Catat pekerjaan tambahan yang Anda lakukan.");
  const byItem = new Map(d.checklist.map((c) => [c.item, c]));
  const missing = CHECKLIST_ITEMS.filter((i) => !byItem.has(i) || byItem.get(i)!.result === "UNKNOWN");
  if (missing.length) reasons.push(`Lengkapi daftar periksa: ${missing.join(", ")}.`);
  const noEvidence = CHECKLIST_ITEMS.filter((i) => {
    const c = byItem.get(i);
    return c && ((c.result === "PASS" && blank(c.evidenceRef)) || (c.result === "N_A" && blank(c.reasoning)));
  });
  if (noEvidence.length) reasons.push(`Isi bukti (untuk Lulus) atau alasan (untuk Tidak berlaku) pada butir ${noEvidence.join(", ")}.`);
  const disp = new Map(d.dispositions.map((x) => [x.noteNo, x]));
  const needFollowUp = d.parentNotes.filter((n) => (n.actionable || isMaterial(n.severity)) && !disp.has(n.noteNo)).map((n) => n.noteNo);
  if (needFollowUp.length) reasons.push(`Beri tindak lanjut untuk catatan ${needFollowUp.join(", ")}.`);
  const dispNoEvidence = d.dispositions.filter((x) => (x.disposition === "RESOLVED" || x.disposition === "ACCEPTED_RISK") && blank(x.evidence)).map((x) => x.noteNo);
  if (dispNoEvidence.length) reasons.push(`Isi bukti tindak lanjut catatan ${dispNoEvidence.join(", ")}.`);
  reasons.push(...deepConfirmBlockers(d));
  return { ready: reasons.length === 0, reasons };
}

// Syarat tambahan khusus "Setujui Enhanced". Pembayaran tidak pernah menggantikan syarat ini.
export function enhancedBlockers(d: DeepState, opts: { rubricApproved: boolean; enabled: boolean }): string[] {
  const out = [...deepReadiness(d).reasons];
  const failed = d.checklist.filter((c) => c.result === "FAIL").map((c) => c.item).sort();
  if (failed.length) out.push(`Ada butir Gagal (${failed.join(", ")}). Enhanced tidak dapat diterbitkan.`);
  const disp = new Map(d.dispositions.map((x) => [x.noteNo, x]));
  const open = d.parentNotes.filter((n) => isMaterial(n.severity) && disp.has(n.noteNo) && disp.get(n.noteNo)!.disposition !== "RESOLVED").map((n) => n.noteNo);
  if (open.length) out.push(`Catatan ${open.join(", ")} (Penting/Sangat penting) harus berstatus sudah diselesaikan.`);
  if (!opts.rubricApproved) out.push("Rubrik material belum disetujui mitra hukum.");
  if (!opts.enabled) out.push("Penerbitan Enhanced belum diaktifkan.");
  return out;
}

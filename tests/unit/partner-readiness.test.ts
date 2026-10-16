import { describe, expect, it } from "vitest";
import { deepReadiness, enhancedBlockers, standardOutcomeBlockers, standardReadiness, type DeepState, type StandardState } from "@/lib/partner/readiness";

const material = { noteNo: 1, severity: "MATERIAL", actionable: true, recommendedAction: "Perjelas", rationale: "Risiko", escalation: "Konsultasi" };
const std = (over: Partial<StandardState> = {}): StandardState => ({ opened: true, authorized: true, scope: "Klausul kerahasiaan", summary: "", notes: [material], ...over });
const PASS = (item: string) => ({ item, result: "PASS", reasoning: "ok", evidenceRef: `Bukti ${item}` });
const ALL = ["M1", "M2", "M3", "M4", "M5", "M6", "M7"];
const deep = (over: Partial<DeepState> = {}): DeepState => ({
  opened: true, authorized: true, extraWork: "Memeriksa ulang klausul", checklist: ALL.map(PASS),
  dispositions: [{ noteNo: 1, disposition: "RESOLVED", evidence: "Klausul 1 diperluas" }], parentNotes: [{ noteNo: 1, severity: "MATERIAL", actionable: true }], ...over,
});

describe("standardOutcomeBlockers (cermin publish_standard)", () => {
  it("lingkup kosong selalu menghalangi", () => {
    for (const o of ["WITH_NOTES", "WITHIN_SCOPE", "INCONCLUSIVE", "DECLINED"] as const) expect(standardOutcomeBlockers(std({ scope: "  " }), o).join(" ")).toContain("Isi ruang lingkup");
  });
  it("Dengan Legal Note: wajib ada catatan; catatan aktionabel wajib tindakan; Penting wajib alasan dan langkah lanjutan", () => {
    expect(standardOutcomeBlockers(std({ notes: [] }), "WITH_NOTES").join(" ")).toMatch(/minimal satu Legal Note/);
    expect(standardOutcomeBlockers(std({ notes: [{ ...material, severity: "MINOR", recommendedAction: " " }] }), "WITH_NOTES").join(" ")).toContain("Catatan 1: isi tindakan yang disarankan");
    expect(standardOutcomeBlockers(std({ notes: [{ ...material, rationale: null }] }), "WITH_NOTES").join(" ")).toContain("Catatan 1: isi tindakan, alasan, dan langkah lanjutan");
    expect(standardOutcomeBlockers(std(), "WITH_NOTES")).toEqual([]);
  });
  it("Tanpa Legal Note: tidak boleh ada catatan; Belum dapat disimpulkan/Tidak dapat memeriksa wajib ringkasan", () => {
    expect(standardOutcomeBlockers(std(), "WITHIN_SCOPE").join(" ")).toMatch(/Hapus semua catatan/);
    expect(standardOutcomeBlockers(std({ notes: [] }), "WITHIN_SCOPE")).toEqual([]);
    expect(standardOutcomeBlockers(std(), "INCONCLUSIVE").join(" ")).toContain("Isi ringkasan");
    expect(standardOutcomeBlockers(std({ summary: "Data kurang" }), "DECLINED")).toEqual([]);
  });
});

describe("standardReadiness (daftar persetujuan)", () => {
  it("siap bila lingkup dan catatan lengkap; belum dibuka dan otorisasi tidak aktif menjadi alasan", () => {
    expect(standardReadiness(std())).toEqual({ ready: true, reasons: [] });
    expect(standardReadiness(std({ notes: [] }))).toEqual({ ready: true, reasons: [] });
    const r = standardReadiness(std({ opened: false, authorized: false, scope: "" }));
    expect(r.ready).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/Belum dibuka/);
    expect(r.reasons.join(" ")).toMatch(/Otorisasi profesional Anda tidak aktif/);
    expect(r.reasons.join(" ")).toMatch(/Isi ruang lingkup/);
  });
});

describe("deepReadiness dan enhancedBlockers (cermin decide_deep)", () => {
  it("checklist lengkap + pekerjaan tambahan + tindak lanjut → siap", () => {
    expect(deepReadiness(deep())).toEqual({ ready: true, reasons: [] });
    expect(enhancedBlockers(deep(), { rubricApproved: true, enabled: true })).toEqual([]);
  });
  it("butir kosong/Belum diketahui, bukti hilang, tindak lanjut hilang dijelaskan dengan teks", () => {
    const r = deepReadiness(deep({ extraWork: "", checklist: [PASS("M1"), { ...PASS("M2"), evidenceRef: "" }, { ...PASS("M3"), result: "UNKNOWN" }], dispositions: [] }));
    expect(r.ready).toBe(false);
    const t = r.reasons.join(" ");
    expect(t).toContain("Catat pekerjaan tambahan");
    expect(t).toContain("Lengkapi checklist: M3, M4, M5, M6, M7");
    expect(t).toContain("M2");
    expect(t).toContain("Beri tindak lanjut untuk catatan 1");
  });
  it("Enhanced: butir Gagal, catatan Penting belum diselesaikan, rubrik dan flag menghalangi", () => {
    const fail = deep({ checklist: ALL.map((i) => (i === "M3" ? { ...PASS(i), result: "FAIL" } : PASS(i))) });
    expect(deepReadiness(fail).ready).toBe(true);
    expect(enhancedBlockers(fail, { rubricApproved: true, enabled: true }).join(" ")).toMatch(/Gagal \(M3\)/);
    const open = deep({ dispositions: [{ noteNo: 1, disposition: "ACCEPTED_RISK", evidence: "x" }] });
    expect(enhancedBlockers(open, { rubricApproved: true, enabled: true }).join(" ")).toMatch(/Catatan 1.*sudah diselesaikan/);
    const t = enhancedBlockers(deep(), { rubricApproved: false, enabled: false }).join(" ");
    expect(t).toMatch(/Rubrik/);
    expect(t).toMatch(/belum diaktifkan/);
  });
});

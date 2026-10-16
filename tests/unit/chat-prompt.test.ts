import { describe, expect, it } from "vitest";
import { buildSystemPrompt, FEW_SHOT } from "@/lib/ai/chat-prompt";
import { groundSuggestions } from "@/lib/ai/grounding";
import { TEMPLATES } from "@/lib/documents/templates/registry";

const templates = Object.values(TEMPLATES);

describe("prompt sistem percakapan dokumen", () => {
  it.each(templates.map((t) => [t.id, t] as const))("%s: tidak memuat format tanggal mesin; data saat ini memakai tanggal Indonesia", (_id, t) => {
    const date = t.fields.find((f) => f.kind === "date")!;
    const p = buildSystemPrompt(t, { [date.key]: "2026-10-16" });
    expect(p).not.toMatch(/YYYY|\d{4}-\d{2}-\d{2}/);
    expect(p).toContain("16 Oktober 2026");
  });

  it.each(templates.map((t) => [t.id, t] as const))("%s: melarang nama kolom dan format mesin di reply, kota tanpa 'Pengadilan Negeri'", (_id, t) => {
    const p = buildSystemPrompt(t, {});
    expect(p).toMatch(/jangan (pernah )?menulis nama kolom/i);
    expect(p).toMatch(/nama kotanya saja/i);
    expect(p).toMatch(/jangan menanyakan kolom yang sudah terisi/i);
  });

  it.each(templates.map((t) => [t.id, t] as const))("%s: memuat contoh percakapan untuk pola kalimat yang terlewat di uji langsung", (_id, t) => {
    const shots = FEW_SHOT[t.category];
    expect(shots.length).toBeGreaterThanOrEqual(2);
    const p = buildSystemPrompt(t, {});
    for (const s of shots) {
      expect(p).toContain(s.message);
      expect(p).toContain(JSON.stringify(s.fields));
    }
  });

  it.each(templates.map((t) => [t.id, t] as const))("%s: setiap contoh hanya mengajarkan nilai yang tertulis (lolos grounding), kolom yang dihitung dibiarkan null", (_id, t) => {
    const keys = new Set(t.fields.map((f) => f.key));
    for (const s of FEW_SHOT[t.category]) {
      for (const k of Object.keys(s.fields)) expect(keys.has(k), k).toBe(true);
      const filled = Object.fromEntries(Object.entries(s.fields).filter(([, v]) => v !== null));
      const grounded = groundSuggestions(t, s.message, filled);
      expect(Object.keys(grounded).sort()).toEqual(Object.keys(filled).sort());
      // Contoh tidak boleh memakai nama/frasa dari skenario uji langsung, agar uji berikutnya tetap jujur.
      expect(s.message).not.toMatch(/Hendra|Irma Suryani|Gilang|Tono Sugiarto|budi|Fitri Handayani/);
    }
  });

  it("pola yang terlewat tercakup: 'Saya X … dari Y', 'Saya X dan Y', nama satu kata huruf kecil, frasa pendek, 'selama setahun' tidak dihitung", () => {
    const nda = FEW_SHOT.NDA.map((s) => s.message).join(" ");
    expect(nda).toMatch(/^Saya [A-Z]\w+ [A-Z]\w+ merahasiakan data \w+ dari [A-Z]/);
    expect(FEW_SHOT.NDA.some((s) => /setahun/.test(s.message) && s.fields.termMonths === null)).toBe(true);
    expect(FEW_SHOT.PKS.some((s) => /^Saya [A-Z]\w+ [A-Z]\w+ dan [A-Z]/.test(s.message) && s.fields.endDate === null)).toBe(true);
    expect(FEW_SHOT.UTANG_PIUTANG.some((s) => typeof s.fields.creditor === "string" && s.fields.creditor === s.fields.creditor.toLowerCase())).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { MissingFieldsError, canonicalize, parseCanonical, renderDocument } from "@/lib/documents/render";
import { nda } from "@/lib/documents/templates/nda";
import { pks } from "@/lib/documents/templates/pks";
import { utangPiutang } from "@/lib/documents/templates/utang-piutang";
import { AI_DRAFT_LABEL } from "@/lib/copy";
import type { Data } from "@/lib/documents/types";

const ndaData: Data = {
  disclosingParty: "ZZ-PIHAK-SATU", receivingParty: "ZZ-PIHAK-DUA", signingDate: "2026-10-16",
  confidentialInfo: "ZZ-INFO-RAHASIA", purpose: "ZZ-TUJUAN", termMonths: 24, disputeCity: "ZZ-KOTA",
};
const text = (d: ReturnType<typeof renderDocument>) => d.blocks.map((b) => b.text).join("\n");

describe("renderDocument", () => {
  it("setiap nilai sentinel muncul dan tidak ada placeholder tersisa", () => {
    const doc = renderDocument(nda, ndaData, "DRAFT");
    for (const s of ["ZZ-PIHAK-SATU", "ZZ-PIHAK-DUA", "ZZ-INFO-RAHASIA", "ZZ-TUJUAN", "ZZ-KOTA", "16 Oktober 2026"]) {
      expect(text(doc)).toContain(s);
    }
    // Teks klausul persis: satuan "bulan" hanya satu kali.
    expect(text(doc)).toContain("Kewajiban menjaga kerahasiaan berlaku selama 24 bulan terhitung sejak 16 Oktober 2026.");
    expect(text(doc)).not.toMatch(/bulan bulan/);
    expect(text(doc)).not.toMatch(/\{\{\w+\}\}/);
  });

  it("uang diformat Rupiah dan tanggal dalam bahasa Indonesia", () => {
    const doc = renderDocument(utangPiutang, {
      creditor: "A Satu", debtor: "B Dua", signingDate: "2026-10-16", principalIdr: 5000000, dueDate: "2027-01-16", disputeCity: "Surabaya",
    }, "DRAFT");
    expect(text(doc)).toContain("Rp5.000.000");
    expect(text(doc)).toContain("16 Januari 2027");
  });

  it("field wajib hilang → MissingFieldsError dengan daftar key", () => {
    const bad = { ...ndaData };
    delete bad.purpose;
    bad.disputeCity = "   ";
    try {
      renderDocument(nda, bad, "DRAFT");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(MissingFieldsError);
      expect((e as MissingFieldsError).fields.sort()).toEqual(["disputeCity", "purpose"]);
    }
  });

  it("input sama menghasilkan byte kanonik identik; satu karakter beda mengubahnya", () => {
    const a = canonicalize(renderDocument(nda, ndaData, "DRAFT"));
    const b = canonicalize(renderDocument(nda, { ...ndaData }, "DRAFT"));
    expect(a).toBe(b);
    const c = canonicalize(renderDocument(nda, { ...ndaData, disclosingParty: "ZZ-PIHAK-SATUx" }, "DRAFT"));
    expect(c).not.toBe(a);
  });

  it("DRAFT menambah pemberitahuan template belum disetujui; APPROVED tidak", () => {
    expect(text(renderDocument(nda, ndaData, "DRAFT"))).toContain("Template belum disetujui mitra hukum");
    expect(text(renderDocument(nda, ndaData, "APPROVED"))).not.toContain("Template belum disetujui mitra hukum");
  });

  it("label draf AI selalu ada dan metadata template tercatat", () => {
    const doc = renderDocument(pks, {
      partyA: "A", partyB: "B", signingDate: "2026-10-16", scope: "S", startDate: "2026-11-01", endDate: "2027-02-01",
      valueIdr: 1000, paymentDueDays: 7, disputeCity: "K",
    }, "APPROVED");
    expect(doc.label).toBe(AI_DRAFT_LABEL);
    expect([doc.templateId, doc.templateVersion, doc.category, doc.approval]).toEqual(["pks", 1, "PKS", "APPROVED"]);
  });

  it("klausul bersyarat hanya muncul bila fieldnya diisi", () => {
    expect(renderDocument(nda, ndaData, "DRAFT").blocks.some((b) => b.id === "notes")).toBe(false);
    const withNotes = renderDocument(nda, { ...ndaData, additionalNotes: "ZZ-CATATAN" }, "DRAFT");
    expect(withNotes.blocks.some((b) => b.id === "notes" && b.text === "ZZ-CATATAN")).toBe(true);
  });

  it("karakter Unicode, tanda kutip, dan kurung kurawal dari pengguna dipertahankan apa adanya", () => {
    const name = 'Siti Nurhaliza-Ñandú "Ibu" & {{Co}}';
    const doc = renderDocument(nda, { ...ndaData, disclosingParty: name }, "DRAFT");
    expect(text(doc)).toContain(name);
    expect(parseCanonical(canonicalize(doc))).toEqual(doc);
  });

  it("parseCanonical menolak teks yang bukan dokumen", () => {
    expect(() => parseCanonical("bukan json")).toThrow();
    expect(() => parseCanonical("{}")).toThrow();
  });
});

describe("renderPartial (pratinjau bertahap)", () => {
  it("klausul yang semua isiannya ada ditandai lengkap; yang belum, nilai yang ada tetap tampil dan kekosongan ditandai", async () => {
    const { renderPartial } = await import("@/lib/documents/render");
    const rows = renderPartial(nda, { disclosingParty: "Sinta Dewi", receivingParty: "Budi", signingDate: "2026-10-16" });
    const parties = rows.find((r) => r.id === "parties")!;
    expect(parties.complete).toBe(true);
    expect(parties.text).toContain("Sinta Dewi");
    expect(parties.text).toContain("16 Oktober 2026");
    const info = rows.find((r) => r.id === "info")!;
    expect(info.complete).toBe(false);
    expect(info.text).toContain("[Informasi apa yang dirahasiakan belum diisi]");
    const partial = renderPartial(nda, { disclosingParty: "Sinta Dewi", receivingParty: "Budi" }).find((r) => r.id === "parties")!;
    expect(partial.complete).toBe(false);
    expect(partial.text).toContain("Sinta Dewi");
    expect(partial.text).toContain("[Tanggal perjanjian dibuat belum diisi]");
  });

  it("klausul opsional tanpa isian tidak muncul", async () => {
    const { renderPartial } = await import("@/lib/documents/render");
    expect(renderPartial(nda, {}).some((r) => r.id === "notes")).toBe(false);
  });

  it("nilai pengguna berisi {{x}} tidak dipindai ulang", async () => {
    const { renderPartial } = await import("@/lib/documents/render");
    const rows = renderPartial(nda, { disclosingParty: "{{receivingParty}}", receivingParty: "B", signingDate: "2026-10-16" });
    expect(rows.find((r) => r.id === "parties")!.text).toContain("{{receivingParty}}");
  });
});

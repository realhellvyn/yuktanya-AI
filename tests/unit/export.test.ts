import { createHash } from "node:crypto";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { AI_DRAFT_LABEL } from "@/lib/copy";
import { UnsupportedCharactersError, exportDocx, exportPdf, pdfLines, sha256Hex } from "@/lib/documents/export";
import { renderDocument } from "@/lib/documents/render";
import { nda } from "@/lib/documents/templates/nda";
import type { Data } from "@/lib/documents/types";

const data: Data = {
  disclosingParty: "ZZ-PIHAK-SATU", receivingParty: "ZZ-PIHAK-DUA", signingDate: "2026-10-16", confidentialInfo: "ZZ-INFO",
  purpose: "ZZ-TUJUAN", termMonths: 24, disputeCity: "ZZ-KOTA",
};
const doc = (d: Data = data) => renderDocument(nda, d, "DRAFT");

describe("exportDocx", () => {
  it("zip valid berisi judul, nilai sentinel, dan label draf AI", async () => {
    const bytes = await exportDocx(doc());
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe("PK");
    const xml = await (await JSZip.loadAsync(bytes)).file("word/document.xml")!.async("string");
    for (const s of ["Perjanjian Kerahasiaan (NDA)", "ZZ-PIHAK-SATU", "ZZ-KOTA", AI_DRAFT_LABEL]) expect(xml).toContain(s);
  });
});

describe("exportDocx baris baru", () => {
  it("baris baru dalam teks panjang menjadi jeda baris dan teks utuh", async () => {
    const bytes = await exportDocx(doc({ ...data, confidentialInfo: "baris satu\r\nbaris dua" }));
    const xml = await (await JSZip.loadAsync(bytes)).file("word/document.xml")!.async("string");
    expect(xml).toContain("baris satu");
    expect(xml).toContain("baris dua");
    expect(xml).toContain("<w:br/>");
  });
});

describe("exportPdf", () => {
  it("berawalan %PDF dan dapat dimuat ulang dengan ≥ 1 halaman", async () => {
    const bytes = await exportPdf(doc());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it("paragraf sangat panjang menghasilkan lebih dari satu halaman", async () => {
    const long = Array.from({ length: 6000 }, (_, i) => `kata${i}`).join(" ");
    const bytes = await exportPdf(doc({ ...data, confidentialInfo: long.slice(0, 1990) , additionalNotes: long.slice(0, 1990) }));
    const small = await PDFDocument.load(await exportPdf(doc()));
    const big = await PDFDocument.load(bytes);
    expect(big.getPageCount()).toBeGreaterThanOrEqual(small.getPageCount());
    const huge = await exportPdf({ ...doc(), blocks: Array.from({ length: 80 }, (_, i) => ({ id: `p${i}`, kind: "paragraph" as const, text: long.slice(0, 900) })) });
    expect((await PDFDocument.load(huge)).getPageCount()).toBeGreaterThan(1);
  });

  it("karakter di luar WinAnsi ditolak dengan daftar karakter, bukan diganti diam-diam", async () => {
    const err = await exportPdf(doc({ ...data, confidentialInfo: "日本 Nguyễn café" })).catch((e) => e);
    expect(err).toBeInstanceOf(UnsupportedCharactersError);
    expect((err as UnsupportedCharactersError).characters).toEqual(expect.arrayContaining(["日", "本", "ễ"]));
    expect((err as UnsupportedCharactersError).characters).not.toContain("é");
  });

  it("pdfLines memecah baris baru (CRLF/CR/LF) sebelum pemeriksaan dan tidak mengubah teks", () => {
    expect(pdfLines("baris satu\r\nbaris dua\nbaris tiga\rempat")).toEqual(["baris satu", "baris dua", "baris tiga", "empat"]);
    expect(pdfLines("café Rp5.000")).toEqual(["café Rp5.000"]);
  });
});

describe("sha256Hex", () => {
  it("sama dengan node:crypto", () => {
    const b = new TextEncoder().encode("halo");
    expect(sha256Hex(b)).toBe(createHash("sha256").update(b).digest("hex"));
  });
});

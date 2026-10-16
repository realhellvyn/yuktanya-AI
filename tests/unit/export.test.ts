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

describe("blok verifikasi pada ekspor", () => {
  const verification = async () => {
    const { qrPng, verifyUrl } = await import("@/lib/verification/qr");
    const code = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4";
    const url = verifyUrl(code, "https://yuktanya.example");
    return {
      kindTitle: "Yuktanya Legal Verified", statement: "Pemeriksaan selesai dengan catatan. Baca catatan sebelum menggunakan dokumen.\nTidak menjamin keabsahan atau hasil hukum dalam semua keadaan.",
      code, url, originalSha256: "f".repeat(64), qrPng: await qrPng(url),
    };
  };

  it("DOCX memuat URL, kode, pernyataan, kode versi asli dan gambar QR; tanpa verifikasi tidak ada blok", async () => {
    const v = await verification();
    const withV = await JSZip.loadAsync(await exportDocx(doc(), v));
    const xml = await withV.file("word/document.xml")!.async("string");
    for (const s of [v.url, v.code, "Pemeriksaan selesai dengan catatan", "Tidak menjamin keabsahan", `Kode versi asli: ${v.originalSha256}`, "Verifikasi"]) expect(xml).toContain(s);
    expect(Object.keys(withV.files).some((f) => f.startsWith("word/media/"))).toBe(true);
    const plain = await (await JSZip.loadAsync(await exportDocx(doc()))).file("word/document.xml")!.async("string");
    expect(plain).not.toContain("Kode versi asli");
  });

  it("PDF dengan verifikasi dapat dimuat ulang, memuat ≥ 1 halaman, dan hashnya berbeda dari ekspor tanpa verifikasi", async () => {
    const v = await verification();
    const withV = await exportPdf(doc(), v);
    const reloaded = await PDFDocument.load(withV);
    expect(reloaded.getPageCount()).toBeGreaterThanOrEqual(1);
    const plain = await exportPdf(doc());
    expect(sha256Hex(withV)).not.toBe(sha256Hex(plain));
    expect(sha256Hex(withV)).not.toBe(v.originalSha256);
  });
});

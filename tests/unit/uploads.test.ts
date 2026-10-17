import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Document, Packer, Paragraph } from "docx";
import JSZip from "jszip";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import { MAX_UPLOAD_BYTES, UPLOAD_LIMITS } from "@/lib/uploads/limits";
import { detectUpload } from "@/lib/uploads/validate";
import { extractUploadText, withTimeout, TimeoutError } from "@/lib/uploads/parse";
import { triageText } from "@/lib/uploads/triage";
import { titleFromFilename, uploadedDoc, UPLOAD_DOC_LABEL } from "@/lib/uploads/document";
import { handleUpload, type UploadDeps } from "@/lib/uploads/handler";
import { UPLOAD_MESSAGES } from "@/lib/uploads/messages";
import { logUploadIssue } from "@/lib/uploads/log";
import { parseAiReport } from "@/lib/ai/prereview";
import { canonicalize, parseCanonical } from "@/lib/documents/render";
import { AiReviewResult } from "@/components/ai-review/ai-review-result";
import { AI_PREREVIEW_LABEL, UPLOAD_HASH_NOTE, VERIFICATION_TITLES } from "@/lib/copy";
import { exportDocx } from "@/lib/documents/export";
import { PublicVerification } from "@/components/verification/public-verification";
import { UploadHashes } from "@/components/ai-review/upload-hashes";

const enc = (s: string) => new TextEncoder().encode(s);
const LIMITS = UPLOAD_LIMITS.FREE;

async function docxOf(paragraphs: string[]): Promise<Uint8Array> {
  return new Uint8Array(await Packer.toBuffer(new Document({ sections: [{ children: paragraphs.map((t) => new Paragraph({ text: t })) }] })));
}
async function pdfOf(pages: string[][]): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const p = d.addPage();
    lines.forEach((l, i) => p.drawText(l, { x: 50, y: 700 - i * 20, font: f, size: 12 }));
  }
  return d.save();
}
async function zipOf(files: Record<string, string>, level = 6): Promise<Uint8Array> {
  const z = new JSZip();
  for (const [n, c] of Object.entries(files)) z.file(n, c);
  return z.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level } });
}

describe("validasi unggahan: isi + ekstensi + ukuran", () => {
  it("menerima PDF, DOCX, TXT yang isi dan ekstensinya cocok", async () => {
    expect(detectUpload("a.pdf", await pdfOf([["Halo"]]))).toEqual({ ok: true, kind: "PDF" });
    expect(detectUpload("Surat.DOCX", await docxOf(["Halo"]))).toEqual({ ok: true, kind: "DOCX" });
    expect(detectUpload("catatan.txt", enc("Perjanjian sintetis"))).toEqual({ ok: true, kind: "TXT" });
  });

  it("menolak bila byte awal tidak cocok dengan ekstensi", async () => {
    expect(detectUpload("palsu.pdf", await docxOf(["x"]))).toEqual({ ok: false, code: "TYPE_MISMATCH" });
    expect(detectUpload("palsu.docx", await pdfOf([["x"]]))).toEqual({ ok: false, code: "TYPE_MISMATCH" });
    expect(detectUpload("palsu.txt", await pdfOf([["x"]]))).toEqual({ ok: false, code: "TYPE_MISMATCH" });
    expect(detectUpload("palsu.txt", await docxOf(["x"]))).toEqual({ ok: false, code: "TYPE_MISMATCH" });
    expect(detectUpload("biner.txt", new Uint8Array([0x48, 0x00, 0x49]))).toEqual({ ok: false, code: "TYPE_MISMATCH" });
    expect(detectUpload("latin1.txt", new Uint8Array([0x48, 0xe9, 0x49]))).toEqual({ ok: false, code: "TYPE_MISMATCH" });
  });

  it("menolak ekstensi lain dan berkas kosong", () => {
    expect(detectUpload("program.exe", enc("MZ"))).toEqual({ ok: false, code: "UNSUPPORTED_TYPE" });
    expect(detectUpload("tanpa-ekstensi", enc("halo"))).toEqual({ ok: false, code: "UNSUPPORTED_TYPE" });
    expect(detectUpload("gambar.jpg", new Uint8Array([0xff, 0xd8, 0xff]))).toEqual({ ok: false, code: "UNSUPPORTED_TYPE" });
    expect(detectUpload("kosong.txt", new Uint8Array())).toEqual({ ok: false, code: "EMPTY" });
  });

  it("batas ukuran: tepat 5 MB diterima, 1 byte lebih ditolak", () => {
    expect(MAX_UPLOAD_BYTES).toBe(5 * 1024 * 1024);
    const atLimit = new Uint8Array(MAX_UPLOAD_BYTES).fill(0x61);
    expect(detectUpload("besar.txt", atLimit)).toEqual({ ok: true, kind: "TXT" });
    const over = new Uint8Array(MAX_UPLOAD_BYTES + 1).fill(0x61);
    expect(detectUpload("besar.txt", over)).toEqual({ ok: false, code: "TOO_LARGE" });
  });

  it("setiap kode penolakan punya pesan Bahasa Indonesia sederhana tanpa kata 'cap'", () => {
    for (const m of Object.values(UPLOAD_MESSAGES)) {
      expect(m.length).toBeGreaterThan(10);
      expect(m).not.toMatch(/\bcap\b/i);
    }
  });
});

describe("pembacaan teks terisolasi dengan batas", () => {
  it("TXT: paragraf dipisah baris kosong, BOM dibuang", async () => {
    const r = await extractUploadText("TXT", enc("﻿Perjanjian Sewa\n\nPasal 1\nPara pihak sepakat.\r\n\r\nPasal 2"), LIMITS);
    expect(r).toEqual({ ok: true, paragraphs: ["Perjanjian Sewa", "Pasal 1\nPara pihak sepakat.", "Pasal 2"], pages: null, chars: expect.any(Number) });
  });

  it("DOCX (dibuat dengan pustaka docx): teks per paragraf, entitas XML dipulihkan", async () => {
    const r = await extractUploadText("DOCX", await docxOf(["Perjanjian Kerja Sama", "Pasal 1 Hak & Kewajiban <para pihak>", ""]), LIMITS);
    expect(r.ok && r.paragraphs).toEqual(["Perjanjian Kerja Sama", "Pasal 1 Hak & Kewajiban <para pihak>"]);
  });

  it("DOCX tanpa word/document.xml atau ZIP rusak → PARSE_FAILED", async () => {
    expect(await extractUploadText("DOCX", await zipOf({ "a.txt": "hai" }), LIMITS)).toEqual({ ok: false, code: "PARSE_FAILED" });
    expect(await extractUploadText("DOCX", new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]), LIMITS)).toEqual({ ok: false, code: "PARSE_FAILED" });
  });

  it("ZIP bom: isi terdeklarasi sangat besar atau rasio kompresi ekstrem ditolak tanpa diekstrak", async () => {
    const bomb = await zipOf({ "[Content_Types].xml": "<x/>", "word/document.xml": " ".repeat(30_000_000) }, 9);
    expect(bomb.byteLength).toBeLessThan(100_000);
    expect(await extractUploadText("DOCX", bomb, LIMITS)).toEqual({ ok: false, code: "ZIP_LIMIT" });
    const ratio = await zipOf({ "word/document.xml": `<w:p><w:r><w:t>${"a".repeat(3_000_000)}</w:t></w:r></w:p>` }, 9);
    expect(await extractUploadText("DOCX", ratio, LIMITS)).toEqual({ ok: false, code: "ZIP_LIMIT" });
  });

  it("ZIP dengan terlalu banyak entri ditolak", async () => {
    const files: Record<string, string> = { "word/document.xml": "<w:p><w:r><w:t>Hai</w:t></w:r></w:p>" };
    for (let i = 0; i < 400; i++) files[`x/${i}.xml`] = "a";
    expect(await extractUploadText("DOCX", await zipOf(files), LIMITS)).toEqual({ ok: false, code: "ZIP_LIMIT" });
  });

  // Task 24 (A24): batas waktu longgar (5 detik), bukan 1 detik, agar tidak rapuh di mesin CI yang sibuk. Maksud tetap terjaga:
  // pemindaian kuadratik atas ~900.000 karakter butuh puluhan detik hingga jam, jauh di atas batas ini.
  it("XML DOCX yang bermusuhan diproses linear (batas longgar 5 detik): ribuan <w:p> tanpa penutup, tag bertumpuk, spasi panjang", async () => {
    const hostile = [
      "<w:p>".repeat(190_000),
      "<w:p><w:r><w:t>".repeat(60_000),
      `<w:p><w:r><w:t>a${" ".repeat(900_000)}b</w:t></w:r></w:p>`,
      "<".repeat(900_000),
      "<w:t>".repeat(150_000) + "x",
    ];
    for (const xml of hostile) {
      const bytes = await zipOf({ "word/document.xml": xml }, 9);
      const t0 = performance.now();
      const r = await extractUploadText("DOCX", bytes, LIMITS);
      const ms = performance.now() - t0;
      expect(ms).toBeLessThan(5000);
      expect(["EMPTY_TEXT", "TOO_LONG", "PARSE_FAILED", "ZIP_LIMIT", "DOCX_TOO_LARGE", undefined]).toContain(r.ok ? undefined : r.code);
    }
  });

  it("TXT berisi spasi sangat panjang diproses linear (batas longgar 5 detik)", async () => {
    const t0 = performance.now();
    const r = await extractUploadText("TXT", enc(`Pasal 1${" ".repeat(4_000_000)}\nisi`), LIMITS);
    expect(performance.now() - t0).toBeLessThan(5000);
    expect(r.ok).toBe(true);
  });

  it("word/document.xml hasil dekompresi > 2 MB ditolak dengan pesan sederhana (DOCX_TOO_LARGE)", async () => {
    // Teks acak agar rasio kompresi wajar (tidak tertangkap aturan rasio ZIP bom).
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed; };
    const words = Array.from({ length: 420_000 }, () => String.fromCharCode(97 + (rnd() % 26), 97 + (rnd() % 26), 97 + (rnd() % 26), 97 + (rnd() % 26))).join(" ");
    const xml = `<w:p><w:r><w:t>${words}</w:t></w:r></w:p>`;
    expect(xml.length).toBeGreaterThan(2 * 1024 * 1024);
    const r = await extractUploadText("DOCX", await zipOf({ "word/document.xml": xml }, 6), LIMITS);
    expect(r).toEqual({ ok: false, code: "DOCX_TOO_LARGE" });
    expect(UPLOAD_MESSAGES.DOCX_TOO_LARGE).toMatch(/terlalu besar/);
  });

  it("DOCX: tab, baris baru, entitas, paragraf kosong mandiri, dan komentar XML ditangani tokenizer", async () => {
    const xml = '<?xml version="1.0"?><w:document><!-- <w:p><w:t>bukan</w:t></w:p> --><w:body><w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr><w:r><w:t xml:space="preserve">A&amp;B</w:t><w:tab/><w:t>C</w:t><w:br/><w:t>D &#x41;&#66;</w:t></w:r></w:p><w:p/><w:p><w:r><w:t>Kedua</w:t></w:r></w:p></w:body></w:document>';
    const r = await extractUploadText("DOCX", await zipOf({ "word/document.xml": xml }), LIMITS);
    expect(r.ok && r.paragraphs).toEqual(["A&B\tC\nD AB", "Kedua"]);
  });

  it("DOCX: <w:tab /> (dengan spasi sebelum garis miring) dibaca sebagai tab; tab beratribut tetap diabaikan", async () => {
    const xml = '<w:document><w:body><w:p><w:r><w:t>A</w:t><w:tab /><w:t>B</w:t><w:tab w:val="left"/><w:t>C</w:t><w:br /><w:t>D</w:t></w:r></w:p></w:body></w:document>';
    const r = await extractUploadText("DOCX", await zipOf({ "word/document.xml": xml }), LIMITS);
    expect(r.ok && r.paragraphs).toEqual(["A\tBC\nD"]);
  });

  it("PDF berlapis teks terbaca per halaman", async () => {
    const r = await extractUploadText("PDF", await pdfOf([["Perjanjian Sewa (sintetis)", "Pasal 1 Para pihak sepakat."], ["Pasal 2 Penutup"]]), LIMITS);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.pages).toBe(2);
      expect(r.paragraphs.join("\n")).toContain("Pasal 1 Para pihak sepakat.");
      expect(r.paragraphs.join("\n")).toContain("Pasal 2 Penutup");
    }
  });

  it("PDF tanpa lapisan teks (hasil pindai) ditolak dengan kode SCANNED_PDF", async () => {
    expect(await extractUploadText("PDF", await pdfOf([[], []]), LIMITS)).toEqual({ ok: false, code: "SCANNED_PDF" });
  });

  it("PDF rusak → PARSE_FAILED; halaman melebihi batas paket → TOO_MANY_PAGES", async () => {
    expect(await extractUploadText("PDF", enc("%PDF-1.4 rusak"), LIMITS)).toEqual({ ok: false, code: "PARSE_FAILED" });
    const pages = Array.from({ length: LIMITS.maxPages + 1 }, (_, i) => [`Halaman ${i + 1} berisi teks perjanjian sintetis.`]);
    expect(await extractUploadText("PDF", await pdfOf(pages), LIMITS)).toEqual({ ok: false, code: "TOO_MANY_PAGES" });
    expect((await extractUploadText("PDF", await pdfOf(pages), UPLOAD_LIMITS.MEMBER)).ok).toBe(true);
  });

  it("teks melebihi batas karakter paket → TOO_LONG; teks kosong → EMPTY_TEXT", async () => {
    expect(await extractUploadText("TXT", enc("a".repeat(LIMITS.maxChars + 1)), LIMITS)).toEqual({ ok: false, code: "TOO_LONG" });
    expect((await extractUploadText("TXT", enc("a".repeat(LIMITS.maxChars)), LIMITS)).ok).toBe(true);
    expect(await extractUploadText("TXT", enc(" \n\n \t"), LIMITS)).toEqual({ ok: false, code: "EMPTY_TEXT" });
  });

  it("pembacaan yang macet dihentikan oleh batas waktu", async () => {
    await expect(withTimeout(new Promise(() => {}), 20)).rejects.toBeInstanceOf(TimeoutError);
    await expect(withTimeout(Promise.resolve(7), 50)).resolves.toBe(7);
  });

  it("teks hasil pembacaan tidak pernah ditulis ke log", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const SECRET = "RAHASIA-SINTETIS-XYZ";
    await extractUploadText("TXT", enc(`Isi ${SECRET}`), LIMITS);
    await extractUploadText("DOCX", await docxOf([`Isi ${SECRET}`]), LIMITS);
    await extractUploadText("PDF", await pdfOf([[`Isi ${SECRET}`]]), LIMITS);
    await extractUploadText("PDF", enc(`%PDF-1.4 ${SECRET}`), LIMITS);
    for (const s of spies) {
      for (const call of s.mock.calls) expect(JSON.stringify(call)).not.toContain(SECRET);
      s.mockRestore();
    }
  });
});

describe("triase risiko dan dokumen unggahan", () => {
  it("dokumen umum NORMAL; jual beli tanah, waris, akuisisi saham, perkara → HIGH dengan alasan", () => {
    expect(triageText(["Perjanjian kerja sama penjualan kue antara dua UMKM."])).toEqual({ level: "NORMAL", reasons: [] });
    const r = triageText(["Akta jual beli tanah bersertifikat hak milik", "Pembagian harta warisan"]);
    expect(r.level).toBe("HIGH");
    expect(r.reasons.length).toBeGreaterThanOrEqual(2);
    expect(triageText(["Perjanjian pengambilalihan saham PT"]).level).toBe("HIGH");
    expect(triageText(["Surat gugatan ke pengadilan negeri"]).level).toBe("HIGH");
  });

  it("judul dari nama berkas; dokumen unggahan memakai label sendiri dan lolos parseCanonical", () => {
    expect(titleFromFilename("Perjanjian_Sewa-Ruko.final.docx")).toBe("Perjanjian Sewa Ruko final");
    expect(titleFromFilename(".pdf")).toBe("Dokumen unggahan");
    expect(titleFromFilename(`${"a".repeat(300)}.txt`).length).toBeLessThanOrEqual(120);
    const d = uploadedDoc("Perjanjian Sewa", ["Pasal 1", "Isi"]);
    expect(d.label).toBe(UPLOAD_DOC_LABEL);
    expect(d.label).not.toContain("Dibuat dengan bantuan AI");
    expect(d.category).toBe("UPLOAD");
    expect(d.blocks.map((b) => b.kind)).toEqual(["title", "paragraph", "paragraph"]);
    expect(parseCanonical(canonicalize(d))).toEqual(d);
  });
});

describe("gerbang flag AI_PREREVIEW_ENABLED", () => {
  it("flag mati → FEATURE_DISABLED; tidak ada berkas disimpan, tidak ada pembacaan, tidak ada yang dikirim ke AI", async () => {
    const chat = vi.fn();
    const deps: UploadDeps = {
      enabled: () => false,
      getUserId: vi.fn(async () => "u1"),
      plan: vi.fn(async () => ({ plan: "FREE" as const, documentsRemaining: 1, aiReviewsRemaining: 2, messagesRemaining: 20 })),
      blob: { put: vi.fn(), get: vi.fn(), delete: vi.fn() },
      save: vi.fn(),
    };
    const r = await handleUpload(deps, { filename: "a.txt", bytes: enc("Perjanjian"), key: "kunci-uji-123" });
    expect(r).toEqual({ ok: false, code: "FEATURE_DISABLED" });
    expect(deps.getUserId).not.toHaveBeenCalled();
    expect(deps.blob.put).not.toHaveBeenCalled();
    expect(deps.save).not.toHaveBeenCalled();
    expect(chat).not.toHaveBeenCalled();
  });
});

describe("keluaran AI divalidasi skema dan ditampilkan sebagai teks", () => {
  it("kunci tambahan dari model (mis. lencana/verified) dibuang; struktur salah ditolak", () => {
    const r = parseAiReport({ perhatian: ["a"], belumJelas: [], pertanyaanUntukPengacara: ["b"], lencana: "LEGAL", verified: true });
    expect(r).toEqual({ perhatian: ["a"], belumJelas: [], pertanyaanUntukPengacara: ["b"] });
    expect(parseAiReport({ perhatian: "bukan larik", belumJelas: [], pertanyaanUntukPengacara: [] })).toBeNull();
    expect(parseAiReport(null)).toBeNull();
  });

  it("hasil dikelompokkan sesuai wireframe, label wajib persis, AI Verified terpisah dari Legal Verified, HTML tidak dieksekusi", () => {
    const h = renderToStaticMarkup(createElement(AiReviewResult, {
      report: { perhatian: ["<script>alert(1)</script>"], belumJelas: [], pertanyaanUntukPengacara: ["Apakah denda wajar?"] },
      completedAt: "2026-10-16T05:00:00Z",
      verified: true,
    }));
    expect(h).toContain(AI_PREREVIEW_LABEL);
    expect(h).toContain("Analisis awal AI bersifat informasional dan dapat keliru.");
    for (const g of ["Hal yang perlu diperhatikan", "Informasi yang belum jelas", "Saran pertanyaan untuk pengacara"]) expect(h).toContain(g);
    expect(h).toContain(VERIFICATION_TITLES.AI);
    expect(h).toContain("Bukan Legal Verified");
    expect(h).not.toContain("<script>");
    expect(h).toContain("&lt;script&gt;");
    expect(h).toContain("Tidak ada catatan.");
    expect(h).not.toMatch(/\bcap\b/i);
  });
});

describe("label kode (hash) dokumen unggahan", () => {
  it("kartu unggahan menampilkan dua kode dengan label berbeda dan satu kalimat bahwa keduanya memang berbeda", () => {
    const h = renderToStaticMarkup(createElement(UploadHashes, { versionSha256: "a".repeat(64), originalSha256: "b".repeat(64) }));
    expect(h).toContain(`Kode teks yang diperiksa (dipakai di QR dan halaman verifikasi): ${"a".repeat(64)}`);
    expect(h).toContain(`Kode berkas asli yang Anda unggah: ${"b".repeat(64)}`);
    expect(h).toMatch(/memang berbeda/);
    expect(h).not.toMatch(/Kode berkas asli \(SHA-256\)/);
  });

  it("halaman verifikasi publik: catatan teks hasil pembacaan hanya untuk dokumen unggahan", () => {
    const base = { status: "ACTIVE" as const, kind: "AI" as const, issuedAt: "2026-10-16T05:00:00Z", sha256: "c".repeat(64), scopeSummary: null, outcome: "COMPLETED" };
    expect(UPLOAD_HASH_NOTE).toBe("Kode ini untuk teks hasil pembacaan, bukan berkas asli.");
    expect(renderToStaticMarkup(createElement(PublicVerification, { result: { ...base, textExtracted: true }, code: "x" }))).toContain(UPLOAD_HASH_NOTE);
    expect(renderToStaticMarkup(createElement(PublicVerification, { result: { ...base, textExtracted: false }, code: "x" }))).not.toContain(UPLOAD_HASH_NOTE);
  });

  it("blok verifikasi ekspor dokumen unggahan memuat catatan teks hasil pembacaan", async () => {
    const doc = uploadedDoc("Sewa", ["Pasal 1 isi."]);
    const v = { kindTitle: VERIFICATION_TITLES.AI, statement: "s", code: "kode", url: "https://y.example/verify/kode", originalSha256: "d".repeat(64), qrPng: new Uint8Array(), note: UPLOAD_HASH_NOTE };
    const xml = await (await JSZip.loadAsync(await exportDocx(doc, { ...v, qrPng: await (await import("@/lib/verification/qr")).qrPng(v.url) }))).file("word/document.xml")!.async("string");
    expect(xml).toContain(UPLOAD_HASH_NOTE);
  });
});

describe("log kegagalan unggahan tanpa isi", () => {
  it("hanya kode dan nama galat yang dicatat; pesan galat (bisa memuat isi) tidak pernah", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = new TypeError("RAHASIA-ISI-DOKUMEN");
    logUploadIssue("upload", "INTERNAL", err);
    logUploadIssue("ai_review", "AI_UNAVAILABLE");
    expect(spy).toHaveBeenCalledTimes(2);
    expect(JSON.parse(spy.mock.calls[0][0] as string)).toEqual({ event: "upload_issue", stage: "upload", code: "INTERNAL", error: "TypeError" });
    expect(JSON.parse(spy.mock.calls[1][0] as string)).toEqual({ event: "upload_issue", stage: "ai_review", code: "AI_UNAVAILABLE" });
    expect(JSON.stringify(spy.mock.calls)).not.toContain("RAHASIA");
    spy.mockRestore();
  });
});

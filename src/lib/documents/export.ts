import { createHash } from "node:crypto";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import type { RenderedDoc } from "./render";

export const sha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

export class UnsupportedCharactersError extends Error {
  constructor(public readonly characters: string[]) {
    super(`PDF belum mendukung karakter: ${characters.join(" ")}`);
    this.name = "UnsupportedCharactersError";
  }
}

const lines = (text: string) => text.split(/\r\n|\r|\n/);

export async function exportDocx(doc: RenderedDoc): Promise<Uint8Array> {
  const children: Paragraph[] = [];
  for (const b of doc.blocks) {
    if (b.kind === "title") {
      children.push(new Paragraph({ text: b.text, heading: HeadingLevel.TITLE }));
      children.push(new Paragraph({ children: [new TextRun({ text: doc.label, italics: true, size: 18 })], spacing: { after: 200 } }));
    } else if (b.kind === "heading") {
      children.push(new Paragraph({ text: b.text, heading: HeadingLevel.HEADING_2 }));
    } else {
      children.push(new Paragraph({ children: lines(b.text).map((l, i) => new TextRun({ text: l, break: i > 0 ? 1 : undefined })), spacing: { after: 120 } }));
    }
  }
  return new Uint8Array(await Packer.toBuffer(new Document({ sections: [{ children }] })));
}

// Font standar PDF hanya mendukung WinAnsi. Teks tidak pernah diganti diam-diam: karakter lain membuat ekspor PDF ditolak
// dengan daftar karakternya (DOCX tetap tersedia). Menanam font Unicode adalah pekerjaan lanjutan.
const WIN_ANSI = /^[ -~ -ÿ‘’“”–—•…€]$/;

export function pdfLines(text: string): string[] {
  const out = lines(text.replace(/\t/g, "    "));
  const bad = new Set<string>();
  for (const l of out) for (const ch of Array.from(l)) if (!WIN_ANSI.test(ch)) bad.add(ch);
  if (bad.size > 0) throw new UnsupportedCharactersError([...bad]);
  return out;
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of pdfLines(text)) {
    let line = "";
    for (const word of para.split(" ")) {
      let w = word;
      while (font.widthOfTextAtSize(w, size) > maxWidth) {
        // Kata lebih panjang dari satu baris dipotong per karakter.
        let cut = w.length;
        while (cut > 1 && font.widthOfTextAtSize(w.slice(0, cut), size) > maxWidth) cut--;
        if (line) { lines.push(line); line = ""; }
        lines.push(w.slice(0, cut));
        w = w.slice(cut);
      }
      const next = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) <= maxWidth) line = next;
      else { lines.push(line); line = w; }
    }
    lines.push(line);
  }
  return lines;
}

export async function exportPdf(doc: RenderedDoc): Promise<Uint8Array> {
  // Periksa seluruh dokumen dulu supaya galat memuat semua karakter bermasalah sekaligus.
  const bad = new Set<string>();
  for (const t of [doc.label, ...doc.blocks.map((b) => b.text)]) {
    try {
      pdfLines(t);
    } catch (e) {
      if (e instanceof UnsupportedCharactersError) e.characters.forEach((c) => bad.add(c));
      else throw e;
    }
  }
  if (bad.size > 0) throw new UnsupportedCharactersError([...bad]);
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const W = 595.28, H = 841.89, M = 56;
  let page = pdf.addPage([W, H]);
  let y = H - M;

  const draw = (text: string, font: PDFFont, size: number, gapAfter: number) => {
    const lineHeight = size * 1.4;
    for (const line of wrap(text, font, size, W - 2 * M)) {
      if (y - lineHeight < M) { page = pdf.addPage([W, H]); y = H - M; }
      y -= lineHeight;
      if (line) page.drawText(line, { x: M, y, size, font, color: rgb(0.09, 0.13, 0.17) });
    }
    y -= gapAfter;
  };

  for (const b of doc.blocks) {
    if (b.kind === "title") { draw(b.text, bold, 18, 4); draw(doc.label, italic, 9, 14); }
    else if (b.kind === "heading") { y -= 6; draw(b.text, bold, 13, 2); }
    else draw(b.text, regular, 11, 6);
  }
  return pdf.save();
}

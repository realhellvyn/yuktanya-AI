import { createHash } from "node:crypto";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import type { RenderedDoc } from "./render";

export const sha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

export async function exportDocx(doc: RenderedDoc): Promise<Uint8Array> {
  const children: Paragraph[] = [];
  for (const b of doc.blocks) {
    if (b.kind === "title") {
      children.push(new Paragraph({ text: b.text, heading: HeadingLevel.TITLE }));
      children.push(new Paragraph({ children: [new TextRun({ text: doc.label, italics: true, size: 18 })], spacing: { after: 200 } }));
    } else if (b.kind === "heading") {
      children.push(new Paragraph({ text: b.text, heading: HeadingLevel.HEADING_2 }));
    } else {
      children.push(new Paragraph({ children: [new TextRun(b.text)], spacing: { after: 120 } }));
    }
  }
  return new Uint8Array(await Packer.toBuffer(new Document({ sections: [{ children }] })));
}

// Font standar PDF hanya mendukung WinAnsi; karakter lain diganti '?'. Menanam font Unicode adalah pekerjaan lanjutan.
const WIN_ANSI = /^[ -~ -ÿ‘’“”–—•…€]$/;
const safe = (s: string) => Array.from(s.replace(/\t/g, "    ")).map((ch) => (WIN_ANSI.test(ch) ? ch : "?")).join("");

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of safe(text).split(/\r?\n/)) {
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

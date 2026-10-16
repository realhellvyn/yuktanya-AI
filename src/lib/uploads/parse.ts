import { inflateRawSync } from "node:zlib";
import JSZip from "jszip";
import {
  MAX_DOCX_XML_BYTES, MAX_ZIP_ENTRIES, MAX_ZIP_ENTRY_BYTES, MAX_ZIP_RATIO, MAX_ZIP_TOTAL_BYTES, PARSE_TIMEOUT_MS, ZIP_RATIO_MIN_BYTES,
} from "./limits";
import type { UploadKind } from "./validate";

// Pembacaan teks berkas unggahan. Fungsi murni: tidak menyentuh DB, jaringan, berkas, atau log. Teks hasil
// pembacaan TIDAK PERNAH dicatat ke log (tidak ada console.* di modul ini; pdf.js dijalankan dengan verbosity 0).
// Batas: ukuran berkas (validate.ts), jumlah halaman dan karakter per paket, pengaman ZIP bom, XML DOCX ≤ 2 MB, dan batas waktu.
// Semua pemindaian teks linear (tanpa regex yang dapat backtracking kuadratik) karena batas waktu tidak dapat memotong kerja
// sinkron. Risiko sisa: satu halaman PDF yang sangat berat di dalam pdf.js tidak dapat dihentikan di tengah (tanpa worker).
// PDF: hanya PDF berlapis teks. PDF hasil pindai (gambar) ditolak; OCR tidak tersedia.

export type ParseLimits = { maxPages: number; maxChars: number; timeoutMs?: number };
export type ParseCode =
  | "PARSE_FAILED" | "ENCRYPTED" | "SCANNED_PDF" | "TOO_MANY_PAGES" | "TOO_LONG" | "EMPTY_TEXT" | "ZIP_LIMIT" | "DOCX_TOO_LARGE" | "TIMEOUT";
export type ParseResult = { ok: true; paragraphs: string[]; pages: number | null; chars: number } | { ok: false; code: ParseCode };

export class TimeoutError extends Error {
  constructor() {
    super("TIMEOUT");
    this.name = "TimeoutError";
  }
}
class ParseFail extends Error {
  constructor(public readonly code: ParseCode) {
    super(code);
    this.name = "ParseFail";
  }
}

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const t = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new TimeoutError()), ms); });
  return Promise.race([p, t]).finally(() => clearTimeout(timer));
}

// Linear: karakter kendali dibuang per karakter, spasi di akhir baris dipangkas per baris (tanpa regex [ \t]+\n).
const clean = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").split("\n").map((l) => l.trimEnd()).join("\n").trim();
const splitParagraphs = (text: string) => text.replace(/\r\n?/g, "\n").split(/\n[ \t]*\n/).map(clean).filter(Boolean);

function parseTxt(bytes: Uint8Array): { paragraphs: string[]; pages: null } {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw new ParseFail("PARSE_FAILED");
  }
  return { paragraphs: splitParagraphs(text), pages: null };
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

// Tokenizer XML linear untuk word/document.xml: satu kali pindai berbasis indexOf, tanpa regex yang dapat
// backtracking. Hanya paragraf (w:p), teks (w:t), tab (w:tab tanpa atribut), dan baris baru (w:br/w:cr) yang dibaca.
export function docxParagraphs(xml: string, maxChars: number): string[] {
  const paragraphs: string[] = [];
  let cur: string[] = [];
  let total = 0;
  const flush = () => {
    const c = clean(cur.join(""));
    cur = [];
    if (c) paragraphs.push(c);
  };
  let i = 0;
  const n = xml.length;
  while (i < n) {
    const lt = xml.indexOf("<", i);
    if (lt < 0) break;
    if (xml.startsWith("<!--", lt)) {
      const end = xml.indexOf("-->", lt + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }
    const gt = xml.indexOf(">", lt + 1);
    if (gt < 0) break;
    // Nama tag: sampai spasi, '/', atau '>'. Dibatasi panjangnya agar tetap O(1) per tag.
    let j = lt + 1;
    const nameEnd = Math.min(gt, lt + 16);
    while (j < nameEnd) {
      const ch = xml.charCodeAt(j);
      if (ch === 32 || ch === 9 || ch === 10 || ch === 13 || (ch === 47 && j > lt + 1)) break;
      j++;
    }
    const name = xml.slice(lt + 1, j);
    const selfClosing = xml.charCodeAt(gt - 1) === 47;
    // Atribut = ada karakter bukan-spasi setelah nama tag (mis. "<w:tab />" tanpa atribut, "<w:tab w:val=.../>" beratribut).
    const hasAttrs = xml.slice(j, gt - (selfClosing ? 1 : 0)).trim().length > 0;
    if (name === "w:p") {
      flush();
    } else if (name === "/w:p") {
      flush();
    } else if (name === "w:t" && !selfClosing) {
      const next = xml.indexOf("<", gt + 1);
      const raw = xml.slice(gt + 1, next < 0 ? n : next);
      total += raw.length;
      if (total > maxChars * 2) throw new ParseFail("TOO_LONG");
      cur.push(decodeXml(raw));
      i = next < 0 ? n : next;
      continue;
    } else if (name === "w:tab" && selfClosing && !hasAttrs) {
      cur.push("\t");
    } else if ((name === "w:br" || name === "w:cr") && selfClosing) {
      cur.push("\n");
    }
    i = gt + 1;
  }
  flush();
  return paragraphs;
}

// Isi internal JSZip 3.x: ukuran terdeklarasi dan byte terkompresi mentah tersedia tanpa dekompresi.
type ZipData = { compressedSize: number; uncompressedSize: number; compressedContent: Uint8Array | ArrayLike<number>; compression: { magic: string } | null };
const dataOf = (f: JSZip.JSZipObject) => (f as unknown as { _data: ZipData })._data;

async function parseDocx(bytes: Uint8Array, maxChars: number): Promise<{ paragraphs: string[]; pages: null }> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes, { checkCRC32: false });
  } catch {
    throw new ParseFail("PARSE_FAILED");
  }
  const entries = Object.values(zip.files);
  if (entries.length > MAX_ZIP_ENTRIES) throw new ParseFail("ZIP_LIMIT");
  let total = 0;
  for (const f of entries) {
    if (f.dir) continue;
    const d = dataOf(f);
    if (!d || typeof d.uncompressedSize !== "number" || typeof d.compressedSize !== "number") throw new ParseFail("PARSE_FAILED");
    total += d.uncompressedSize;
    if (d.uncompressedSize > MAX_ZIP_ENTRY_BYTES || total > MAX_ZIP_TOTAL_BYTES) throw new ParseFail("ZIP_LIMIT");
    if (d.uncompressedSize >= ZIP_RATIO_MIN_BYTES && d.uncompressedSize / Math.max(1, d.compressedSize) > MAX_ZIP_RATIO) throw new ParseFail("ZIP_LIMIT");
  }
  const main = zip.file("word/document.xml");
  if (!main) throw new ParseFail("PARSE_FAILED");
  const d = dataOf(main);
  if (d.uncompressedSize > MAX_DOCX_XML_BYTES) throw new ParseFail("DOCX_TOO_LARGE");
  const raw = Buffer.from(d.compressedContent as Uint8Array);
  let xmlBytes: Buffer;
  try {
    // Dekompresi dengan batas keluaran keras (2 MB): header ZIP yang berbohong tetap tidak bisa membesarkan kerja/memori.
    if (d.compression?.magic === "\x08\x00") xmlBytes = inflateRawSync(raw, { maxOutputLength: MAX_DOCX_XML_BYTES });
    else if (d.compression?.magic === "\x00\x00") xmlBytes = raw;
    else throw new ParseFail("PARSE_FAILED");
  } catch (e) {
    if (e instanceof ParseFail) throw e;
    if (e instanceof RangeError || (e as NodeJS.ErrnoException)?.code === "ERR_BUFFER_TOO_LARGE") throw new ParseFail("DOCX_TOO_LARGE");
    throw new ParseFail("PARSE_FAILED");
  }
  if (xmlBytes.byteLength > MAX_DOCX_XML_BYTES) throw new ParseFail("DOCX_TOO_LARGE");
  return { paragraphs: docxParagraphs(xmlBytes.toString("utf8"), maxChars), pages: null };
}

type TextItem = { str?: string; hasEOL?: boolean };

// PDF dibaca per halaman dengan tenggat kooperatif: di antara halaman, tenggat dan batas karakter diperiksa sehingga
// kerja berhenti lebih awal. Satu panggilan pdf.js untuk satu halaman tetap tidak dapat dihentikan di tengah jalan.
async function parsePdf(bytes: Uint8Array, limits: ParseLimits, deadline: number): Promise<{ paragraphs: string[]; pages: number }> {
  const { getDocumentProxy } = await import("unpdf");
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    // Salinan byte: pdf.js boleh memindahkan buffer. Build serverless unpdf tidak mengevaluasi kode dari berkas.
    pdf = await getDocumentProxy(bytes.slice(), { verbosity: 0, disableFontFace: true, useSystemFonts: false, stopAtErrors: true });
  } catch (e) {
    if ((e as Error)?.name === "PasswordException") throw new ParseFail("ENCRYPTED");
    throw new ParseFail("PARSE_FAILED");
  }
  try {
    if (pdf.numPages > limits.maxPages) throw new ParseFail("TOO_MANY_PAGES");
    const pagesText: string[] = [];
    let chars = 0;
    for (let i = 1; i <= pdf.numPages; i++) {
      if (Date.now() > deadline) throw new TimeoutError();
      let text: string;
      try {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text = (content.items as TextItem[]).map((it) => (it.str ?? "") + (it.hasEOL ? "\n" : "")).join("");
      } catch {
        throw new ParseFail("PARSE_FAILED");
      }
      chars += text.length;
      if (chars > limits.maxChars * 2) throw new ParseFail("TOO_LONG");
      pagesText.push(text);
    }
    const visible = pagesText.reduce((sum, t) => sum + t.replace(/\s+/g, "").length, 0);
    // Rata-rata < 10 huruf per halaman: hampir pasti hasil pindai (gambar) dengan sedikit atau tanpa lapisan teks.
    if (visible === 0 || visible / Math.max(1, pdf.numPages) < 10) throw new ParseFail("SCANNED_PDF");
    return { paragraphs: pagesText.flatMap(splitParagraphs), pages: pdf.numPages };
  } finally {
    // Bebaskan sumber daya pdf.js (nama metode berbeda antarversi build).
    const p = pdf as unknown as { destroy?: () => Promise<void>; loadingTask?: { destroy?: () => Promise<void> } };
    await (p.destroy?.() ?? p.loadingTask?.destroy?.())?.catch(() => undefined);
  }
}

export async function extractUploadText(kind: UploadKind, bytes: Uint8Array, limits: ParseLimits): Promise<ParseResult> {
  const timeout = limits.timeoutMs ?? PARSE_TIMEOUT_MS;
  try {
    const run: Promise<{ paragraphs: string[]; pages: number | null }> =
      kind === "TXT" ? Promise.resolve().then(() => parseTxt(bytes))
        : kind === "DOCX" ? parseDocx(bytes, limits.maxChars)
          : parsePdf(bytes, limits, Date.now() + timeout);
    // withTimeout hanya menghentikan MENUNGGU pekerjaan asinkron; kerja sinkron tidak dapat dipotong. Karena itu semua
    // pembacaan dibuat linear dan dibatasi ukurannya (5 MB berkas, 2 MB XML DOCX, batas halaman/karakter).
    const { paragraphs, pages } = await withTimeout(run, timeout);
    const chars = paragraphs.reduce((n, p) => n + p.length, 0);
    if (chars === 0) return { ok: false, code: "EMPTY_TEXT" };
    if (chars > limits.maxChars) return { ok: false, code: "TOO_LONG" };
    return { ok: true, paragraphs, pages, chars };
  } catch (e) {
    if (e instanceof ParseFail) return { ok: false, code: e.code };
    if (e instanceof TimeoutError) return { ok: false, code: "TIMEOUT" };
    return { ok: false, code: "PARSE_FAILED" };
  }
}

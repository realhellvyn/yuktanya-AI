import { inflateRawSync } from "node:zlib";
import JSZip from "jszip";
import {
  MAX_ZIP_ENTRIES, MAX_ZIP_ENTRY_BYTES, MAX_ZIP_RATIO, MAX_ZIP_TOTAL_BYTES, PARSE_TIMEOUT_MS, ZIP_RATIO_MIN_BYTES,
} from "./limits";
import type { UploadKind } from "./validate";

// Pembacaan teks berkas unggahan. Fungsi murni: tidak menyentuh DB, jaringan, berkas, atau log. Teks hasil
// pembacaan TIDAK PERNAH dicatat ke log (tidak ada console.* di modul ini; pdf.js dijalankan dengan verbosity 0).
// Batas: ukuran berkas (validate.ts), jumlah halaman dan karakter per paket, pengaman ZIP bom, dan batas waktu.
// PDF: hanya PDF berlapis teks. PDF hasil pindai (gambar) ditolak; OCR tidak tersedia.

export type ParseLimits = { maxPages: number; maxChars: number; timeoutMs?: number };
export type ParseCode =
  | "PARSE_FAILED" | "ENCRYPTED" | "SCANNED_PDF" | "TOO_MANY_PAGES" | "TOO_LONG" | "EMPTY_TEXT" | "ZIP_LIMIT" | "TIMEOUT";
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

const clean = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/[ \t]+\n/g, "\n").trim();
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

// Isi internal JSZip 3.x: ukuran terdeklarasi dan byte terkompresi mentah tersedia tanpa dekompresi.
type ZipData = { compressedSize: number; uncompressedSize: number; compressedContent: Uint8Array | ArrayLike<number>; compression: { magic: string } | null };
const dataOf = (f: JSZip.JSZipObject) => (f as unknown as { _data: ZipData })._data;

async function parseDocx(bytes: Uint8Array): Promise<{ paragraphs: string[]; pages: null }> {
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
  const raw = Buffer.from(d.compressedContent as Uint8Array);
  let xmlBytes: Buffer;
  try {
    // Dekompresi dengan batas keluaran keras: header ZIP yang berbohong tetap tidak bisa meledakkan memori.
    if (d.compression?.magic === "\x08\x00") xmlBytes = inflateRawSync(raw, { maxOutputLength: MAX_ZIP_ENTRY_BYTES });
    else if (d.compression?.magic === "\x00\x00") xmlBytes = raw;
    else throw new ParseFail("PARSE_FAILED");
  } catch (e) {
    if (e instanceof ParseFail) throw e;
    if (e instanceof RangeError || (e as NodeJS.ErrnoException)?.code === "ERR_BUFFER_TOO_LARGE") throw new ParseFail("ZIP_LIMIT");
    throw new ParseFail("PARSE_FAILED");
  }
  const xml = xmlBytes.toString("utf8");
  const paragraphs: string[] = [];
  for (const p of xml.match(/<w:p[\s>][\s\S]*?<\/w:p>/g) ?? []) {
    let text = "";
    for (const m of p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\b[^>]*\/>|<w:cr\/>/g)) {
      if (m[1] !== undefined) text += decodeXml(m[1]);
      else if (m[0].startsWith("<w:tab")) text += "\t";
      else text += "\n";
    }
    const c = clean(text);
    if (c) paragraphs.push(c);
  }
  return { paragraphs, pages: null };
}

async function parsePdf(bytes: Uint8Array, maxPages: number): Promise<{ paragraphs: string[]; pages: number }> {
  const { getDocumentProxy, extractText } = await import("unpdf");
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    // Salinan byte: pdf.js boleh memindahkan buffer. Build serverless unpdf tidak mengevaluasi kode dari berkas.
    pdf = await getDocumentProxy(bytes.slice(), { verbosity: 0, disableFontFace: true, useSystemFonts: false, stopAtErrors: true });
  } catch (e) {
    if ((e as Error)?.name === "PasswordException") throw new ParseFail("ENCRYPTED");
    throw new ParseFail("PARSE_FAILED");
  }
  try {
    if (pdf.numPages > maxPages) throw new ParseFail("TOO_MANY_PAGES");
    let pagesText: string[];
    try {
      pagesText = (await extractText(pdf, { mergePages: false })).text;
    } catch {
      throw new ParseFail("PARSE_FAILED");
    }
    const visible = pagesText.reduce((n, t) => n + t.replace(/\s+/g, "").length, 0);
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
  try {
    const run: Promise<{ paragraphs: string[]; pages: number | null }> = kind === "TXT" ? Promise.resolve().then(() => parseTxt(bytes)) : kind === "DOCX" ? parseDocx(bytes) : parsePdf(bytes, limits.maxPages);
    const { paragraphs, pages } = await withTimeout(run, limits.timeoutMs ?? PARSE_TIMEOUT_MS);
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

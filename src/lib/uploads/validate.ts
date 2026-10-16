import { MAX_UPLOAD_BYTES } from "./limits";

export type UploadKind = "PDF" | "DOCX" | "TXT";
export type DetectCode = "EMPTY" | "TOO_LARGE" | "UNSUPPORTED_TYPE" | "TYPE_MISMATCH";
export type DetectResult = { ok: true; kind: UploadKind } | { ok: false; code: DetectCode };

const EXT: Record<string, UploadKind> = { pdf: "PDF", docx: "DOCX", txt: "TXT" };
const startsWith = (b: Uint8Array, sig: number[]) => sig.every((x, i) => b[i] === x);
const PDF_SIG = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const ZIP_SIG = [0x50, 0x4b, 0x03, 0x04]; // PK\3\4

// Jenis berkas ditentukan dari isi (byte awal) DAN ekstensi; keduanya harus cocok. Tipe MIME dari peramban tidak dipercaya.
export function detectUpload(filename: string, bytes: Uint8Array): DetectResult {
  const m = /\.([A-Za-z0-9]+)$/.exec(filename.trim());
  const kind = m ? EXT[m[1].toLowerCase()] : undefined;
  if (!kind) return { ok: false, code: "UNSUPPORTED_TYPE" };
  if (bytes.byteLength === 0) return { ok: false, code: "EMPTY" };
  if (bytes.byteLength > MAX_UPLOAD_BYTES) return { ok: false, code: "TOO_LARGE" };
  const isPdf = startsWith(bytes, PDF_SIG);
  const isZip = startsWith(bytes, ZIP_SIG);
  if (kind === "PDF") return isPdf ? { ok: true, kind } : { ok: false, code: "TYPE_MISMATCH" };
  if (kind === "DOCX") return isZip ? { ok: true, kind } : { ok: false, code: "TYPE_MISMATCH" };
  // TXT: wajib UTF-8 valid tanpa byte NUL/kendali biner, dan bukan PDF/ZIP yang diganti namanya.
  if (isPdf || isZip || !isPlainUtf8(bytes)) return { ok: false, code: "TYPE_MISMATCH" };
  return { ok: true, kind };
}

function isPlainUtf8(bytes: Uint8Array): boolean {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return false;
  }
  // Tab, LF, CR, dan FF diizinkan; kendali C0 lain atau DEL menandakan berkas biner.
  return !/[\u0000-\u0008\u000b\u000e-\u001f\u007f]/.test(text);
}

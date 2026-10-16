import { formatDateId, parseDateId } from "@/lib/documents/format";
import type { Data, Template } from "@/lib/documents/types";

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

// Batas kata Unicode: nilai tidak boleh hanya potongan di tengah kata/angka lain ("Budi" bukan bagian dari "Budiman").
const BEFORE = "(?<![\\p{L}\\p{N}])";
const AFTER = "(?![\\p{L}\\p{N}])";
const wholeToken = (literal: string): RegExp => new RegExp(BEFORE + esc(collapse(literal)).replace(/ /g, "\\s+") + AFTER, "iu");

// Tanggal di cerita tidak boleh menyumbang angka hari/tahun sebagai kandidat jumlah.
const DATE_SPANS = new RegExp(
  "\\d{4}-\\d{2}-\\d{2}|\\d{1,2}/\\d{1,2}/\\d{4}|\\d{1,2}\\s+(?:januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\\s+\\d{4}",
  "giu",
);

// Token angka di cerita: "5.000.000" → 5000000, "24" → 24. Desimal/koma (mis. "5,5") sengaja tidak dihitung.
// Tanda baca di ujung token ("Rp5.000.000.") dibuang sebelum dinilai.
function numbersIn(story: string): Set<number> {
  const out = new Set<number>();
  for (const raw of story.replace(DATE_SPANS, " ").match(/\d[\d.,]*/g) ?? []) {
    const tok = raw.replace(/[.,]+$/, "");
    if (/^\d+$/.test(tok)) out.add(Number(tok));
    else if (/^\d{1,3}(\.\d{3})+$/.test(tok)) out.add(Number(tok.replace(/\./g, "")));
  }
  return out;
}

// Hanya nilai yang tertulis di cerita pengguna yang lolos; sisanya dibuang. Tidak ada nilai yang dikarang model.
export function groundSuggestions(template: Template, story: string, raw: Record<string, unknown>): Data {
  const out: Data = {};
  const numbers = numbersIn(story);
  for (const f of template.fields) {
    const v = raw[f.key];
    if (v === undefined || v === null) continue;
    if (f.kind === "text" || f.kind === "longtext" || f.kind === "choice") {
      if (typeof v !== "string" || collapse(v) === "") continue;
      const m = wholeToken(v).exec(story);
      if (!m) continue;
      const found = collapse(m[0]);
      if (f.kind === "choice") {
        const option = (f.options ?? []).find((o) => o.toLowerCase() === found.toLowerCase());
        if (option) out[f.key] = option;
      } else out[f.key] = found;
    } else if (f.kind === "idr" || f.kind === "integer") {
      const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v.trim()) : NaN;
      if (Number.isSafeInteger(n) && n > 0 && numbers.has(n)) out[f.key] = n;
    } else if (f.kind === "date") {
      if (typeof v !== "string") continue;
      let iso: string;
      try {
        iso = parseDateId(v);
      } catch {
        continue;
      }
      const [y, mo, d] = iso.split("-").map(Number);
      const forms = [iso, formatDateId(iso), `${d}/${mo}/${y}`, `${String(d).padStart(2, "0")}/${String(mo).padStart(2, "0")}/${y}`];
      if (forms.some((x) => wholeToken(x).test(story))) out[f.key] = iso;
    }
  }
  return out;
}

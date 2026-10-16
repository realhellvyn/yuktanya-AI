import { createHash } from "node:crypto";
import { parseDateId } from "../format";
import { stableStringify } from "../stable";
import { RENDER_VERSION } from "../version";
import type { ClauseSpec, Data, FieldSpec, Template, ValidationResult } from "../types";

type Def = Omit<Template, "validate" | "normalize" | "contentHash"> & { cross?: (d: Data) => Record<string, string> };

type HashSource = Pick<Template, "id" | "version" | "fields" | "clauses" | "title" | "category">;

// Semua yang memengaruhi keluaran dokumen ikut di-hash, termasuk judul, kategori, dan versi aturan render.
export function templateHashInput(t: HashSource) {
  const clauses = t.clauses.map((c: ClauseSpec) => ({ id: c.id, heading: c.heading ?? null, text: c.text, whenKey: c.whenKey ?? null }));
  return { id: t.id, version: t.version, title: t.title, category: t.category, fields: t.fields, clauses, renderVersion: RENDER_VERSION };
}

export function templateHash(t: HashSource): string {
  return createHash("sha256").update(stableStringify(templateHashInput(t))).digest("hex");
}

export const normalizeName = (s: unknown): string => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

// Awalan nama pengadilan yang sudah ada di klausul "Pengadilan Negeri {{disputeCity}}".
export const COURT_PREFIXES = ["Pengadilan Negeri", "PN", "Pengadilan", "Kota"];

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Membuang awalan (berulang, tanpa membedakan huruf besar; "PN." juga) lalu, bila sisanya huruf kecil semua,
// menulis tiap kata berhuruf besar di awal ("pn semarang" → "Semarang"). Nilai yang hanya berisi awalan dibiarkan.
export function normalizeFieldValue(f: FieldSpec, v: string | number): string | number {
  if (typeof v !== "string" || !f.prefixes?.length) return v;
  let s = v.replace(/\s+/g, " ").trim();
  if (s === "" || f.prefixes.some((p) => p.toLowerCase() === s.toLowerCase())) return v;
  const heads = [...f.prefixes].sort((a, b) => b.length - a.length).map((p) => new RegExp(`^${escRe(p).replace(/ /g, "\\s+")}\\.?\\s+`, "i"));
  for (let re = heads.find((h) => h.test(s)); re; re = heads.find((h) => h.test(s))) s = s.replace(re, "").trim();
  return s === s.toLowerCase() ? s.replace(/(^|[\s-])(\p{Ll})/gu, (_m, a: string, c: string) => a + c.toUpperCase()) : s;
}

export function normalizeData(fields: FieldSpec[], d: Data): Data {
  const out: Data = { ...d };
  for (const f of fields) if (out[f.key] !== undefined) out[f.key] = normalizeFieldValue(f, out[f.key]);
  return out;
}

const isBlank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

// Karakter kontrol ditolak; teks panjang boleh berisi tab dan baris baru, teks singkat tidak.
const CTRL_SINGLE = /[\u0000-\u001F\u007F]/;
const CTRL_MULTI = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const BAD_CHARS = "Teks mengandung karakter yang tidak didukung";

function checkField(f: FieldSpec, v: unknown): string | null {
  switch (f.kind) {
    case "text":
      if (typeof v === "string" && CTRL_SINGLE.test(v)) return BAD_CHARS;
      return typeof v === "string" && v.trim().length <= 200 ? null : "Isi dengan teks singkat (maksimal 200 karakter)";
    case "longtext":
      if (typeof v === "string" && CTRL_MULTI.test(v)) return BAD_CHARS;
      return typeof v === "string" && v.trim().length <= 2000 ? null : "Isi dengan teks (maksimal 2000 karakter)";
    case "idr":
      return typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? null : "Isi dengan angka rupiah lebih dari 0";
    case "integer":
      return typeof v === "number" && Number.isInteger(v) && v > 0 && v <= 10_000 ? null : "Isi dengan bilangan bulat lebih dari 0";
    case "date":
      try {
        return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && parseDateId(v) === v ? null : "Tanggal tidak valid";
      } catch {
        return "Tanggal tidak valid";
      }
    case "choice":
      return typeof v === "string" && (f.options ?? []).includes(v) ? null : "Pilih salah satu pilihan yang tersedia";
  }
}

export function defineTemplate(def: Def): Template {
  const { cross, ...base } = def;
  const t: Template = {
    ...base,
    validate(input: Data): ValidationResult {
      const errors: Record<string, string> = {};
      const out: Data = {};
      const d = normalizeData(base.fields, input);
      for (const f of base.fields) {
        const v = d[f.key];
        if (isBlank(v)) {
          if (f.required) errors[f.key] = "Wajib diisi";
          continue;
        }
        const err = checkField(f, v);
        if (err) errors[f.key] = err;
        else out[f.key] = typeof v === "string" ? v.trim() : (v as number);
      }
      if (cross) for (const [k, m] of Object.entries(cross(out))) if (!errors[k]) errors[k] = m;
      return Object.keys(errors).length ? { ok: false, errors } : { ok: true, data: out };
    },
    normalize: (d: Data) => normalizeData(base.fields, d),
    contentHash: () => templateHash(base),
  };
  return t;
}

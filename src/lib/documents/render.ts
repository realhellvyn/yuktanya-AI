import { AI_DRAFT_LABEL } from "@/lib/copy";
import { formatDateId, formatIdr } from "./format";
import { stableStringify } from "./stable";
import type { Data, DocCategory, FieldSpec, Template } from "./types";

export type Block = { id: string; kind: "title" | "heading" | "paragraph"; text: string };
export type RenderedDoc = {
  templateId: string;
  templateVersion: number;
  category: DocCategory;
  approval: "APPROVED" | "DRAFT";
  label: string;
  blocks: Block[];
};

export class MissingFieldsError extends Error {
  constructor(public readonly fields: string[], public readonly errors: Record<string, string>) {
    super(`Data belum lengkap atau tidak valid: ${fields.join(", ")}`);
    this.name = "MissingFieldsError";
  }
}

const DRAFT_NOTICE = "Template belum disetujui mitra hukum";

function show(f: FieldSpec, v: string | number): string {
  if (f.kind === "idr") return formatIdr(Number(v));
  if (f.kind === "date") return formatDateId(String(v));
  return String(v);
}

export function renderDocument(t: Template, input: Data, approval: "APPROVED" | "DRAFT"): RenderedDoc {
  const checked = t.validate(input);
  if (!checked.ok) throw new MissingFieldsError(Object.keys(checked.errors), checked.errors);
  const data = checked.data;
  const byKey = new Map(t.fields.map((f) => [f.key, f]));

  const blocks: Block[] = [{ id: "title", kind: "title", text: t.title }];
  if (approval === "DRAFT") blocks.push({ id: "approval-notice", kind: "paragraph", text: DRAFT_NOTICE });

  for (const c of t.clauses) {
    if (c.whenKey && data[c.whenKey] === undefined) continue;
    if (c.heading) blocks.push({ id: `${c.id}:h`, kind: "heading", text: c.heading });
    // Satu kali substitusi: nilai pengguna tidak dipindai ulang, jadi "{{x}}" dari pengguna tetap apa adanya.
    const text = c.text.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => {
      const f = byKey.get(key);
      const v = data[key];
      if (!f || v === undefined) throw new MissingFieldsError([key], { [key]: "Wajib diisi" });
      return show(f, v);
    });
    blocks.push({ id: c.id, kind: "paragraph", text });
  }
  return { templateId: t.id, templateVersion: t.version, category: t.category, approval, label: AI_DRAFT_LABEL, blocks };
}

export function canonicalize(doc: RenderedDoc): string {
  return stableStringify(doc);
}

export function parseCanonical(text: string): RenderedDoc {
  const v = JSON.parse(text) as Partial<RenderedDoc>;
  const ok =
    v && typeof v.templateId === "string" && typeof v.templateVersion === "number" && typeof v.category === "string" &&
    (v.approval === "APPROVED" || v.approval === "DRAFT") && typeof v.label === "string" && Array.isArray(v.blocks) &&
    v.blocks.every((b) => b && typeof b.id === "string" && typeof b.text === "string" && ["title", "heading", "paragraph"].includes(b.kind));
  if (!ok) throw new Error("Byte kanonik dokumen tidak valid");
  return v as RenderedDoc;
}

export type PartialRow = { id: string; heading?: string; text: string; complete: boolean };

// Pratinjau saat mengisi: hanya klausul yang seluruh isiannya sudah ada. Bukan dokumen resmi; tidak dipakai untuk membuat versi.
export function renderPartial(t: Template, input: Data): PartialRow[] {
  const data = t.normalize(input);
  const byKey = new Map(t.fields.map((f) => [f.key, f]));
  const blank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");
  const rows: PartialRow[] = [];
  for (const c of t.clauses) {
    if (c.whenKey && blank(data[c.whenKey])) continue;
    const keys = [...c.text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
    const complete = keys.every((k) => !blank(data[k]));
    const text = c.text.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => {
      const f = byKey.get(key);
      if (!f) return "";
      return blank(data[key]) ? `[${f.label} belum diisi]` : show(f, data[key] as string | number);
    });
    rows.push({ id: c.id, heading: c.heading, text, complete });
  }
  return rows;
}

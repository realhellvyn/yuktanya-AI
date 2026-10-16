import { formatDateId, formatIdr } from "./format";
import type { Data, FieldSpec, Template } from "./types";

export type Step = { index: number; total: number; field: FieldSpec };

const blank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

export function buildSteps(t: Template): Step[] {
  return t.fields.map((field, i) => ({ index: i + 1, total: t.fields.length, field }));
}

// Langkah wajib pertama yang belum terisi; field opsional boleh dikosongkan.
export function nextMissing(t: Template, data: Data): Step | null {
  return buildSteps(t).find((s) => s.field.required && blank(data[s.field.key])) ?? null;
}

export function progress(t: Template, data: Data): { done: number; total: number; percent: number } {
  const required = t.fields.filter((f) => f.required);
  const done = required.filter((f) => !blank(data[f.key])).length;
  return { done, total: required.length, percent: required.length ? Math.round((done / required.length) * 100) : 100 };
}

export function summarize(t: Template, data: Data): { label: string; value: string }[] {
  return t.fields.map((f) => {
    const v = data[f.key];
    if (blank(v)) return { label: f.label, value: f.required ? "(belum diisi)" : "(tidak diisi)" };
    if (f.kind === "idr") return { label: f.label, value: formatIdr(Number(v)) };
    if (f.kind === "date") return { label: f.label, value: formatDateId(String(v)) };
    return { label: f.label, value: String(v) };
  });
}

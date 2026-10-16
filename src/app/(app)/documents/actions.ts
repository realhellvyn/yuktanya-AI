"use server";

import { randomUUID } from "node:crypto";
import { notFound, redirect } from "next/navigation";
import { FormatError, parseDateId, parseIdr } from "@/lib/documents/format";
import { documentsService } from "@/lib/documents/runtime";
import { StaleRevisionError } from "@/lib/documents/service";
import { requireUserId } from "@/lib/documents/session";
import { TemplateNotApprovedError, TEMPLATES } from "@/lib/documents/templates/registry";
import type { Category, Data, FieldKind } from "@/lib/documents/types";

const CATEGORIES: Category[] = ["PKS", "UTANG_PIUTANG", "NDA"];
const str = (f: FormData, k: string) => String(f.get(k) ?? "");

function parseField(kind: FieldKind, raw: string): string | number {
  const v = raw.trim();
  if (kind === "idr") return parseIdr(v);
  if (kind === "date") return parseDateId(v);
  if (kind === "integer") {
    if (!/^\d+$/.test(v)) throw new FormatError("Isi dengan angka bulat, contoh: 24");
    return Number(v);
  }
  return v;
}

export async function createDocumentAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const category = str(formData, "category") as Category;
  if (!CATEGORIES.includes(category)) notFound();
  let documentId: string;
  try {
    ({ documentId } = await documentsService().create(userId, category, randomUUID()));
  } catch (e) {
    if (e instanceof TemplateNotApprovedError) redirect(`/workspace/new?error=${encodeURIComponent("Dokumen ini belum tersedia.")}`);
    if (e instanceof Error && e.message.includes("TOO_MANY_DRAFTS")) redirect(`/workspace/new?error=${encodeURIComponent("Anda punya terlalu banyak draf yang belum selesai. Selesaikan salah satunya dulu.")}`);
    throw e;
  }
  redirect(`/workspace/${documentId}`);
}

export async function saveStepAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const documentId = str(formData, "documentId");
  const fieldKey = str(formData, "fieldKey");
  const stepIndex = Number(str(formData, "stepIndex"));
  const revision = Number(str(formData, "revision"));
  const svc = documentsService();
  const doc = await svc.get(userId, documentId);
  if (!doc || !Number.isInteger(revision) || revision < 0) notFound();
  const t = TEMPLATES[doc.category];
  const field = t.fields.find((f) => f.key === fieldKey);
  if (!field) notFound();
  const back = (msg: string): never => redirect(`/workspace/${documentId}?step=${stepIndex}&error=${encodeURIComponent(msg)}`);

  const data: Data = { ...doc.draft.data };
  const raw = str(formData, "value");
  if (raw.trim() === "") {
    delete data[fieldKey];
    if (field.required) back("Wajib diisi");
  } else {
    try {
      data[fieldKey] = parseField(field.kind, raw);
    } catch (e) {
      back(e instanceof FormatError ? e.message : "Isian belum sesuai");
    }
  }
  const checked = t.validate(data);
  if (!checked.ok && checked.errors[fieldKey]) back(checked.errors[fieldKey]);

  try {
    await svc.saveDraft(userId, documentId, data, revision);
  } catch (e) {
    if (e instanceof StaleRevisionError) back("Draf ini sudah berubah di tab lain. Muat ulang halaman, lalu coba lagi.");
    throw e;
  }
  redirect(stepIndex < t.fields.length ? `/workspace/${documentId}?step=${stepIndex + 1}` : `/workspace/${documentId}?step=ringkasan`);
}

export async function freezeAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const documentId = str(formData, "documentId");
  const token = str(formData, "token");
  const svc = documentsService();
  const doc = await svc.get(userId, documentId);
  if (!doc || token.length < 8) notFound();
  const summary = (msg: string): never => redirect(`/workspace/${documentId}?step=ringkasan&error=${encodeURIComponent(msg)}`);

  const r = await svc.freeze(userId, documentId, token);
  if (r.ok) redirect(`/documents/${documentId}?version=${r.versionId}&baru=1`);
  if (r.code === "VALIDATION_FAILED") {
    const fields = TEMPLATES[doc.category].fields;
    const idx = fields.findIndex((f) => r.errors[f.key]);
    const key = fields[idx]?.key ?? "";
    redirect(`/workspace/${documentId}?step=${idx + 1}&error=${encodeURIComponent(r.errors[key] ?? "Data belum lengkap")}`);
  }
  if (r.code === "DOCUMENT_DAILY_QUOTA_REACHED") summary("Batas pembuatan dokumen baru hari ini sudah tercapai. Draf Anda aman, dan Anda bisa melanjutkan besok mulai pukul 00.00 WIB.");
  summary("Template ini belum tersedia.");
}

export async function exportAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const documentId = str(formData, "documentId");
  const versionId = str(formData, "versionId");
  const format = str(formData, "format") === "PDF" ? "PDF" : "DOCX";
  const e = await documentsService().exportVersion(userId, versionId, format);
  if (!e) notFound();
  redirect(`/documents/${documentId}?version=${versionId}&exported=${e.exportId}`);
}

export async function startNewVersionAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const documentId = str(formData, "documentId");
  const versionId = str(formData, "versionId");
  const svc = documentsService();
  const [doc, version] = await Promise.all([svc.get(userId, documentId), svc.getVersion(userId, versionId)]);
  if (!doc || !version || version.documentId !== documentId) notFound();
  try {
    await svc.saveDraft(userId, documentId, version.structuredData, doc.draft.revision);
  } catch (e) {
    if (!(e instanceof StaleRevisionError)) throw e;
  }
  redirect(`/workspace/${documentId}?step=ringkasan`);
}

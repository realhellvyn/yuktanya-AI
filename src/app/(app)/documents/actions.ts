"use server";

import { randomUUID } from "node:crypto";
import { notFound, redirect } from "next/navigation";
import { UnsupportedCharactersError } from "@/lib/documents/export";
import { documentsService } from "@/lib/documents/runtime";
import { StaleRevisionError } from "@/lib/documents/service";
import { requireUserId } from "@/lib/documents/session";
import { handleChatTurn } from "@/lib/ai/chat-turn";
import { chatTurnDeps } from "@/lib/vault/runtime";
import { TemplateNotApprovedError } from "@/lib/documents/templates/registry";
import type { Category } from "@/lib/documents/types";

const CATEGORIES: Category[] = ["PKS", "UTANG_PIUTANG", "NDA"];
const str = (f: FormData, k: string) => String(f.get(k) ?? "");

export async function createDocumentAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const category = str(formData, "category") as Category;
  if (!CATEGORIES.includes(category)) notFound();
  let documentId: string;
  try {
    ({ documentId } = await documentsService().create(userId, category, randomUUID()));
  } catch (e) {
    // Hanya kode; halaman memetakan kode ke kalimat tetap (teks dari alamat tidak pernah ditampilkan apa adanya).
    if (e instanceof TemplateNotApprovedError) redirect("/workspace/new?error=template");
    if (e instanceof Error && e.message.includes("TOO_MANY_DRAFTS")) redirect("/workspace/new?error=too-many-drafts");
    throw e;
  }
  redirect(`/workspace/${documentId}`);
}

export async function sendMessageAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const documentId = str(formData, "documentId");
  const retry = str(formData, "retry") === "1";
  const message = str(formData, "message");
  const key = str(formData, "key") || randomUUID();
  const res = await handleChatTurn(
    chatTurnDeps(),
    new Request("http://internal/chat", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify(retry ? { retry: true } : { message }) }),
    { id: documentId },
  );
  if (res.status === 404) notFound();
  let notice = "";
  if (res.status !== 200) {
    const code = ((await res.json().catch(() => ({}))) as { code?: string }).code;
    notice =
      res.status === 502 ? "down"
      : code === "STALE_REVISION" ? "stale"
      : code === "AI_BUSY" || code === "DUPLICATE_REQUEST" ? "busy"
      : code === "TOO_MANY_ATTEMPTS" ? "limit"
      : res.status === 429 ? "quota"
      : "error";
  }
  void userId;
  redirect(`/workspace/${documentId}${notice ? `?notice=${notice}` : ""}`);
}

export async function freezeAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const documentId = str(formData, "documentId");
  const token = str(formData, "token");
  const svc = documentsService();
  const doc = await svc.get(userId, documentId);
  if (!doc || token.length < 8) notFound();
  const back = (notice: string): never => redirect(`/workspace/${documentId}?notice=${notice}`);

  const r = await svc.freeze(userId, documentId, token);
  if (r.ok) redirect(`/documents/${documentId}?version=${r.versionId}&baru=1`);
  if (r.code === "VALIDATION_FAILED") {
    back("incomplete");
  }
  if (r.code === "DOCUMENT_DAILY_QUOTA_REACHED") back("docQuota");
  back("noTemplate");
}

export async function exportAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const documentId = str(formData, "documentId");
  const versionId = str(formData, "versionId");
  const format = str(formData, "format") === "PDF" ? "PDF" : "DOCX";
  const e = await documentsService().exportVersion(userId, versionId, format).catch((err: unknown) => {
    if (err instanceof UnsupportedCharactersError) redirect(`/documents/${documentId}?version=${versionId}&error=pdf`);
    throw err;
  });
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

export async function cloneAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const c = await documentsService().clone(userId, str(formData, "versionId"), randomUUID()).catch((e: unknown) => {
    if (e instanceof Error && e.message.includes("TOO_MANY_DRAFTS")) {
      // Hanya kode: halaman memetakan kode ke kalimat tetap (teks bebas di alamat tidak pernah ditampilkan).
      redirect("/workspace/new?error=too-many-drafts");
    }
    throw e;
  });
  if (!c) notFound();
  redirect(`/workspace/${c.documentId}?step=ringkasan`);
}

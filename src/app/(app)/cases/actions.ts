"use server";

import { redirect } from "next/navigation";
import { requireUserId } from "@/lib/documents/session";
import { isUuid } from "@/lib/cases/pages";
import { casesService } from "@/lib/cases/runtime";
import { CaseError } from "@/lib/cases/service";
import { caseErrorText } from "@/lib/cases/view";

const str = (f: FormData, k: string) => String(f.get(k) ?? "");

export type SubmitCaseState = { error?: string; values?: { summary: string; consent: boolean } };

// Kepemilikan dokumen, persetujuan, dan isi ringkasan diperiksa ulang di database; formulir hanya membawa data mentah.
export async function submitCaseAction(_prev: SubmitCaseState, formData: FormData): Promise<SubmitCaseState> {
  const userId = await requireUserId();
  const documentId = str(formData, "documentId");
  const summary = str(formData, "summary");
  const consent = formData.get("consent") === "yes";
  const key = str(formData, "key");
  const values = { summary, consent };
  if (documentId && !isUuid(documentId)) return { error: caseErrorText("NOT_FOUND")!, values };
  if (!/^[A-Za-z0-9-]{8,64}$/.test(key)) return { error: "Formulir sudah kedaluwarsa. Muat ulang halaman, lalu kirim lagi.", values };
  let id: string;
  try {
    id = await casesService().submit(userId, { documentId: documentId || null, summary, consent, key });
  } catch (e) {
    if (e instanceof CaseError) return { error: caseErrorText(e.code)!, values };
    throw e;
  }
  redirect(`/cases/${id}?ok=dikirim`);
}

async function decide(formData: FormData, fn: (userId: string, id: string) => Promise<void>, ok: string): Promise<never> {
  const userId = await requireUserId();
  const id = str(formData, "caseId");
  if (!isUuid(id)) redirect("/cases");
  try {
    await fn(userId, id);
  } catch (e) {
    if (e instanceof CaseError) redirect(`/cases/${id}?e=${e.code}`);
    throw e;
  }
  redirect(`/cases/${id}?ok=${ok}`);
}

export async function acceptQuoteAction(formData: FormData): Promise<void> {
  if (formData.get("confirm") !== "yes") redirect(`/cases/${encodeURIComponent(str(formData, "caseId"))}?e=CONFIRM_REQUIRED`);
  await decide(formData, (u, id) => casesService().accept(u, id, Number(str(formData, "revision"))), "diterima");
}

export async function declineQuoteAction(formData: FormData): Promise<void> {
  await decide(formData, (u, id) => casesService().decline(u, id), "ditolak");
}

// Dua langkah: tombol konfirmasi di halaman membawa confirm=yes; tanpa itu tidak ada perubahan.
export async function withdrawCaseAction(formData: FormData): Promise<void> {
  if (formData.get("confirm") !== "yes") redirect(`/cases/${encodeURIComponent(str(formData, "caseId"))}?e=WITHDRAW_CONFIRM`);
  await decide(formData, (u, id) => casesService().close(u, id, "Ditarik pemilik"), "ditarik");
}

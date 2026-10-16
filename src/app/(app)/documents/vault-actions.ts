"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { assistDeps, evidenceDeps, reminderService, shareService } from "@/lib/vault/runtime";
import { handleAssist } from "@/lib/ai/assist";
import { requireUserId } from "@/lib/documents/session";
import { NotFoundError } from "@/lib/documents/service";
import { buildEvidencePack, RateLimitedError } from "@/lib/vault/evidence";
import { FeatureNotAvailableError } from "@/lib/vault/features";
import { InvalidOffsetsError } from "@/lib/vault/reminders";
import { InvalidExpiryError, TooManySharesError } from "@/lib/vault/share";
import type { CreateShareState } from "@/components/vault/create-share-form";

const str = (f: FormData, k: string) => String(f.get(k) ?? "");
const panel = (documentId: string, versionId: string, extra = "") => `/documents/${documentId}?version=${versionId}${extra}`;

export async function createShareAction(_prev: CreateShareState, formData: FormData): Promise<CreateShareState> {
  const userId = await requireUserId();
  const days = [1, 7, 30].includes(Number(str(formData, "days"))) ? Number(str(formData, "days")) : 7;
  try {
    const { token } = await shareService().create(userId, str(formData, "versionId"), days * 24 * 3600);
    const origin = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    return { link: `${origin}/s/${token}` };
  } catch (e) {
    if (e instanceof FeatureNotAvailableError) return { error: "Fitur ini tersedia untuk Member." };
    if (e instanceof NotFoundError) return { error: "Versi tidak ditemukan." };
    if (e instanceof InvalidExpiryError) return { error: "Masa berlaku tautan tidak valid." };
    if (e instanceof TooManySharesError) return { error: "Tautan aktif untuk versi ini sudah 20. Cabut tautan yang tidak dipakai lebih dulu." };
    throw e;
  }
}

export async function revokeShareAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  await shareService().revoke(userId, str(formData, "shareId")).catch((e: unknown) => {
    if (!(e instanceof NotFoundError)) throw e;
  });
  redirect(panel(str(formData, "documentId"), str(formData, "versionId")));
}

export async function setReminderAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const [documentId, versionId] = [str(formData, "documentId"), str(formData, "versionId")];
  const offsets = formData.getAll("offset").map((v) => Number(v));
  try {
    await reminderService().set(userId, versionId, str(formData, "specId"), offsets);
  } catch (e) {
    if (e instanceof FeatureNotAvailableError) redirect(panel(documentId, versionId, "&notice=feature"));
    if (e instanceof InvalidOffsetsError) redirect(panel(documentId, versionId, "&notice=offsets"));
    if (e instanceof NotFoundError) redirect(panel(documentId, versionId));
    throw e;
  }
  redirect(panel(documentId, versionId));
}

export async function cancelReminderAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  await reminderService().cancel(userId, str(formData, "versionId"), str(formData, "specId"));
  redirect(panel(str(formData, "documentId"), str(formData, "versionId")));
}

export async function buildPackAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const [documentId, versionId] = [str(formData, "documentId"), str(formData, "versionId")];
  try {
    const pack = await buildEvidencePack(evidenceDeps(), userId, documentId);
    if (!pack) redirect(panel(documentId, versionId));
    redirect(panel(documentId, versionId, `&pack=${pack.packId}`));
  } catch (e) {
    if (e instanceof RateLimitedError) redirect(panel(documentId, versionId, "&notice=rate"));
    if (e instanceof FeatureNotAvailableError) redirect(panel(documentId, versionId, "&notice=feature"));
    throw e;
  }
}

// Bantuan AI: hasil dikembalikan sebagai kode ringkas, bukan teks bebas.
export async function assistAction(formData: FormData): Promise<void> {
  await requireUserId();
  const id = str(formData, "documentId");
  const res = await handleAssist(
    assistDeps(),
    new Request("http://internal/assist", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ story: str(formData, "story") }) }),
    { id },
  );
  const body = (await res.json().catch(() => ({}))) as { applied?: string[]; fallback?: string; code?: string };
  let code = "down";
  if (res.status === 200) code = body.fallback ? "manual" : (body.applied?.length ?? 0) > 0 ? "ok" : "none";
  else if (res.status === 429) code = body.code === "AI_BUSY" || body.code === "TOO_MANY_ATTEMPTS" ? "busy" : "quota";
  redirect(`/workspace/${id}?step=ringkasan&assist=${code}`);
}

"use server";

import { redirect } from "next/navigation";
import { handleAiReview } from "@/lib/ai/prereview";
import { aiReviewStatus } from "@/lib/ai/review-status";
import { requireUserId } from "@/lib/documents/session";
import { flags } from "@/lib/flags";
import { handleUpload } from "@/lib/uploads/handler";
import { MAX_UPLOAD_BYTES } from "@/lib/uploads/limits";
import { UPLOAD_MESSAGES, type UploadCode } from "@/lib/uploads/messages";
import { uploadDeps } from "@/lib/uploads/runtime";
import { aiReviewDeps } from "@/lib/vault/runtime";

export type UploadState = { error?: string; code?: UploadCode; consent?: boolean };

// Unggah → versi beku → (bila tidak berisiko tinggi) analisis awal AI dengan persetujuan eksplisit.
// Flag mati: tidak ada berkas disimpan dan tidak ada yang dikirim ke AI. Isi berkas tidak pernah dicatat ke log.
export async function uploadAction(_prev: UploadState, formData: FormData): Promise<UploadState> {
  await requireUserId();
  const consent = formData.get("consent") === "yes";
  const fail = (code: UploadCode): UploadState => ({ error: UPLOAD_MESSAGES[code], code, consent });
  if (!flags.aiPreReview) return fail("FEATURE_DISABLED");
  const file = formData.get("file");
  if (!(file instanceof File) || (file.size === 0 && !file.name)) return fail("NO_FILE");
  if (!consent) return fail("NO_CONSENT");
  if (file.size > MAX_UPLOAD_BYTES) return fail("TOO_LARGE");
  const key = String(formData.get("key") ?? "");

  let result;
  try {
    result = await handleUpload(uploadDeps(), { filename: file.name, bytes: new Uint8Array(await file.arrayBuffer()), key });
  } catch {
    return fail("INTERNAL");
  }
  if (!result.ok) return fail(result.code);
  const base = `/documents/${result.documentId}?version=${result.versionId}&unggah=1`;
  if (result.duplicate || result.risk.level === "HIGH") redirect(`${base}#analisis-ai`);

  const res = await handleAiReview(
    aiReviewDeps(),
    new Request("http://internal/ai-review", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": `ai-${key}` },
      body: JSON.stringify({ consent: true }),
    }),
    { versionId: result.versionId },
  );
  redirect(`${base}&ai=${aiReviewStatus(res.status)}#analisis-ai`);
}

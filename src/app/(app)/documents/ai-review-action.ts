"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { handleAiReview } from "@/lib/ai/prereview";
import { aiReviewStatus } from "@/lib/ai/review-status";
import { requireUserId } from "@/lib/documents/session";
import { aiReviewDeps } from "@/lib/vault/runtime";

export async function aiReviewAction(formData: FormData): Promise<void> {
  await requireUserId();
  const documentId = String(formData.get("documentId") ?? "");
  const versionId = String(formData.get("versionId") ?? "");
  const res = await handleAiReview(
    aiReviewDeps(),
    new Request("http://internal/ai-review", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": randomUUID() },
      body: JSON.stringify({ consent: formData.get("consent") === "yes" }),
    }),
    { versionId },
  );
  redirect(`/documents/${documentId}?version=${versionId}&ai=${aiReviewStatus(res.status)}#analisis-ai`);
}

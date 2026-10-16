"use server";

import { redirect } from "next/navigation";
import { afterPublishPath } from "@/lib/reviews/paths";
import { deepService } from "@/lib/deep/runtime";
import { flags } from "@/lib/flags";
import { formInt, formUuid } from "@/lib/partner/form";
import { ReviewError } from "@/lib/reviews/service";
import { partnerActor } from "@/lib/partner/actor";

const str = (f: FormData, k: string) => String(f.get(k) ?? "");
const page = (id: string, q = "") => `/partner/deep/${id}${q}`;
const INVALID = "e=INVALID_REQUEST";

// ID pemeriksaan rusak → kembali ke antrean; revisi atau nomor rusak → kembali ke editor. Keduanya dengan pemberitahuan biasa.
function deepId(f: FormData): string {
  const id = formUuid(f, "deepId");
  if (!id) redirect(`/partner?${INVALID}`);
  return id;
}
function intOr(f: FormData, key: string, id: string, min = 0): number {
  const n = formInt(f, key, min);
  if (n === null) redirect(page(id, `?${INVALID}`));
  return n;
}
async function run(id: string, fn: () => Promise<string>): Promise<never> {
  try {
    redirect(page(id, `?${await fn()}`));
  } catch (e) {
    if (e instanceof ReviewError) redirect(page(id, `?e=${e.code}${e.reason ? `&r=${e.reason}` : ""}`));
    throw e;
  }
}

export async function saveDeepDraftAction(formData: FormData): Promise<void> {
  const s = await partnerActor("reviewer");
  const id = deepId(formData);
  const revision = intOr(formData, "revision", id);
  await run(id, async () => {
    await deepService().saveDraft(s.userId, id, revision, { extraWork: str(formData, "extraWork"), summary: str(formData, "summary") });
    return "ok=draft";
  });
}

export async function setDispositionAction(formData: FormData): Promise<void> {
  const s = await partnerActor("reviewer");
  const id = deepId(formData);
  const revision = intOr(formData, "revision", id);
  const noteNo = intOr(formData, "noteNo", id, 1);
  await run(id, async () => {
    await deepService().setDisposition(s.userId, id, revision, noteNo, str(formData, "disposition"), str(formData, "evidence"));
    return "ok=disp";
  });
}

export async function setChecklistAction(formData: FormData): Promise<void> {
  const s = await partnerActor("reviewer");
  const id = deepId(formData);
  const revision = intOr(formData, "revision", id);
  await run(id, async () => {
    await deepService().setChecklist(s.userId, id, revision, str(formData, "item"), str(formData, "result"), str(formData, "reasoning"), str(formData, "evidenceRef"));
    return "ok=chk";
  });
}

export async function decideDeepAction(formData: FormData): Promise<void> {
  const s = await partnerActor("reviewer");
  const id = deepId(formData);
  const revision = intOr(formData, "revision", id);
  const decision = str(formData, "decision") as "APPROVE";
  if (decision === "APPROVE" && !flags.enhancedIssuance) redirect(page(id, "?e=ENHANCED_DISABLED"));
  let outcome: string;
  try {
    outcome = (await deepService().decide(s.userId, id, {
      revision, decision, reason: str(formData, "reason") || null, attest: formData.get("attest") === "yes",
      noConflict: formData.get("noConflict") === "yes", enhancedEnabled: flags.enhancedIssuance,
    })).outcome;
  } catch (e) {
    if (e instanceof ReviewError) redirect(page(id, `?e=${e.code}${e.reason ? `&r=${e.reason}` : ""}`));
    throw e;
  }
  redirect(afterPublishPath(outcome));
}

export async function assignDeepAction(formData: FormData): Promise<void> {
  const s = await partnerActor("routing");
  const back = s.roles.includes("platform_admin") ? "/admin/routing" : "/partner";
  const id = formUuid(formData, "deepId");
  const reviewer = formUuid(formData, "reviewerId");
  if (!id || !reviewer) redirect(`${back}?${INVALID}`);
  try {
    if (str(formData, "mode") === "reassign") await deepService().reassign(s.userId, id, reviewer);
    else await deepService().assign(s.userId, id, reviewer);
  } catch (e) {
    if (e instanceof ReviewError) redirect(`${back}?e=${e.code}`);
    throw e;
  }
  redirect(`${back}?ok=assigned`);
}

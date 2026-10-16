"use server";

import { redirect } from "next/navigation";
import { afterPublishPath } from "@/lib/reviews/paths";
import { deepService } from "@/lib/deep/runtime";
import { flags } from "@/lib/flags";
import { ReviewError } from "@/lib/reviews/service";
import { getSessionRoles } from "@/lib/supabase/server";

const str = (f: FormData, k: string) => String(f.get(k) ?? "");
const num = (f: FormData, k: string) => Number(f.get(k) ?? 0);
const page = (id: string, q = "") => `/partner/deep/${id}${q}`;

async function actor() {
  const s = await getSessionRoles();
  if (!s) redirect("/login");
  return s;
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
  const s = await actor();
  const id = str(formData, "deepId");
  await run(id, async () => {
    await deepService().saveDraft(s.userId, id, num(formData, "revision"), { extraWork: str(formData, "extraWork"), summary: str(formData, "summary") });
    return "ok=draft";
  });
}

export async function setDispositionAction(formData: FormData): Promise<void> {
  const s = await actor();
  const id = str(formData, "deepId");
  await run(id, async () => {
    await deepService().setDisposition(s.userId, id, num(formData, "revision"), num(formData, "noteNo"), str(formData, "disposition"), str(formData, "evidence"));
    return "ok=disp";
  });
}

export async function setChecklistAction(formData: FormData): Promise<void> {
  const s = await actor();
  const id = str(formData, "deepId");
  await run(id, async () => {
    await deepService().setChecklist(s.userId, id, num(formData, "revision"), str(formData, "item"), str(formData, "result"), str(formData, "reasoning"), str(formData, "evidenceRef"));
    return "ok=chk";
  });
}

export async function decideDeepAction(formData: FormData): Promise<void> {
  const s = await actor();
  const id = str(formData, "deepId");
  const decision = str(formData, "decision") as "APPROVE";
  if (decision === "APPROVE" && !flags.enhancedIssuance) redirect(page(id, "?e=ENHANCED_DISABLED"));
  let outcome: string;
  try {
    outcome = (await deepService().decide(s.userId, id, num(formData, "revision"), decision, str(formData, "reason") || null, formData.get("attest") === "yes")).outcome;
  } catch (e) {
    if (e instanceof ReviewError) redirect(page(id, `?e=${e.code}${e.reason ? `&r=${e.reason}` : ""}`));
    throw e;
  }
  redirect(afterPublishPath(outcome));
}

export async function assignDeepAction(formData: FormData): Promise<void> {
  const s = await actor();
  const back = s.roles.includes("platform_admin") ? "/admin/routing" : "/partner";
  try {
    const fn = str(formData, "mode") === "reassign" ? deepService().reassign : deepService().assign;
    await fn.call(deepService(), s.userId, str(formData, "deepId"), str(formData, "reviewerId"));
  } catch (e) {
    if (e instanceof ReviewError) redirect(`${back}?e=${e.code}`);
    throw e;
  }
  redirect(`${back}?ok=assigned`);
}

"use server";

import { redirect } from "next/navigation";
import { afterPublishPath } from "@/lib/reviews/paths";
import { reviewService } from "@/lib/reviews/runtime";
import { ReviewError } from "@/lib/reviews/service";
import { getSessionRoles } from "@/lib/supabase/server";

const str = (f: FormData, k: string) => String(f.get(k) ?? "");
const num = (f: FormData, k: string) => Number(f.get(k) ?? 0);
const opt = (f: FormData, k: string) => (str(f, k).trim() === "" ? null : str(f, k).trim());
const page = (id: string, q = "") => `/partner/reviews/${id}${q}`;

async function actor() {
  const s = await getSessionRoles();
  if (!s) redirect("/login");
  return s;
}

// Kegagalan menjadi kode ringkas di URL; teks ditampilkan oleh halaman.
async function run(id: string, fn: () => Promise<string | void>): Promise<never> {
  try {
    const extra = await fn();
    redirect(page(id, extra ? `?${extra}` : ""));
  } catch (e) {
    if (e instanceof ReviewError) redirect(page(id, `?e=${e.code}${e.reason ? `&r=${e.reason}` : ""}`));
    throw e;
  }
}

export async function saveDraftAction(formData: FormData): Promise<void> {
  const s = await actor();
  const id = str(formData, "requestId");
  await run(id, async () => {
    await reviewService().saveDraft(s.userId, id, num(formData, "revision"), { scope: str(formData, "scope"), assumptions: str(formData, "assumptions"), summary: str(formData, "summary") });
    return "ok=draft";
  });
}

export async function upsertNoteAction(formData: FormData): Promise<void> {
  const s = await actor();
  const id = str(formData, "requestId");
  await run(id, async () => {
    const no = num(formData, "noteNo");
    await reviewService().upsertNote(s.userId, id, num(formData, "revision"), {
      noteNo: no > 0 ? no : undefined, blockId: opt(formData, "blockId"), quote: opt(formData, "quote"), title: str(formData, "title"), finding: str(formData, "finding"),
      severity: str(formData, "severity") as "INFO", actionable: formData.get("actionable") === "yes",
      recommendedAction: opt(formData, "recommendedAction"), rationale: opt(formData, "rationale"), escalation: opt(formData, "escalation"),
    });
    return "ok=note";
  });
}

export async function deleteNoteAction(formData: FormData): Promise<void> {
  const s = await actor();
  const id = str(formData, "requestId");
  await run(id, async () => {
    await reviewService().deleteNote(s.userId, id, num(formData, "revision"), num(formData, "noteNo"));
    return "ok=note";
  });
}

export async function publishAction(formData: FormData): Promise<void> {
  const s = await actor();
  const id = str(formData, "requestId");
  let status: string;
  try {
    status = (await reviewService().publish(s.userId, id, {
      revision: num(formData, "revision"), outcome: str(formData, "outcome") as "WITH_NOTES",
      noNotesDeclared: formData.get("noNotesDeclared") === "yes", attest: formData.get("attest") === "yes",
    })).status;
  } catch (e) {
    if (e instanceof ReviewError) redirect(page(id, `?e=${e.code}${e.reason ? `&r=${e.reason}` : ""}`));
    throw e;
  }
  redirect(afterPublishPath(status));
}

export async function reassignAction(formData: FormData): Promise<void> {
  const s = await actor();
  const id = str(formData, "requestId");
  const back = s.roles.includes("platform_admin") ? "/admin/routing" : "/partner";
  try {
    await reviewService().reassign(s.userId, id, str(formData, "reviewerId"));
  } catch (e) {
    if (e instanceof ReviewError) redirect(`${back}?e=${e.code}`);
    throw e;
  }
  redirect(`${back}?ok=assigned`);
}

export async function assignAction(formData: FormData): Promise<void> {
  const s = await actor();
  const id = str(formData, "requestId");
  try {
    await reviewService().assign(s.userId, id, str(formData, "reviewerId"));
  } catch (e) {
    if (e instanceof ReviewError) redirect(`${s.roles.includes("platform_admin") ? "/admin/routing" : "/partner"}?e=${e.code}`);
    throw e;
  }
  redirect(`${s.roles.includes("platform_admin") ? "/admin/routing" : "/partner"}?ok=assigned`);
}

"use server";

import { redirect } from "next/navigation";
import { formInt, formUuid } from "@/lib/partner/form";
import { afterPublishPath } from "@/lib/reviews/paths";
import { reviewService } from "@/lib/reviews/runtime";
import { ReviewError } from "@/lib/reviews/service";
import { getSessionRoles } from "@/lib/supabase/server";

const str = (f: FormData, k: string) => String(f.get(k) ?? "");
const opt = (f: FormData, k: string) => (str(f, k).trim() === "" ? null : str(f, k).trim());
const page = (id: string, q = "") => `/partner/reviews/${id}${q}`;
const INVALID = "e=INVALID_REQUEST";

async function actor() {
  const s = await getSessionRoles();
  if (!s) redirect("/login");
  return s;
}

// ID permintaan rusak → kembali ke antrean; revisi atau nomor rusak → kembali ke editor. Keduanya dengan pemberitahuan biasa.
function requestId(f: FormData): string {
  const id = formUuid(f, "requestId");
  if (!id) redirect(`/partner?${INVALID}`);
  return id;
}
function intOr(f: FormData, key: string, id: string, min = 0): number {
  const n = formInt(f, key, min);
  if (n === null) redirect(page(id, `?${INVALID}`));
  return n;
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
  const id = requestId(formData);
  const revision = intOr(formData, "revision", id);
  await run(id, async () => {
    await reviewService().saveDraft(s.userId, id, revision, { scope: str(formData, "scope"), assumptions: str(formData, "assumptions"), summary: str(formData, "summary") });
    return "ok=draft";
  });
}

export async function upsertNoteAction(formData: FormData): Promise<void> {
  const s = await actor();
  const id = requestId(formData);
  const revision = intOr(formData, "revision", id);
  const no = formData.get("noteNo") ? intOr(formData, "noteNo", id) : 0;
  await run(id, async () => {
    await reviewService().upsertNote(s.userId, id, revision, {
      noteNo: no > 0 ? no : undefined, blockId: opt(formData, "blockId"), quote: opt(formData, "quote"), title: str(formData, "title"), finding: str(formData, "finding"),
      severity: str(formData, "severity") as "INFO", actionable: formData.get("actionable") === "yes",
      recommendedAction: opt(formData, "recommendedAction"), rationale: opt(formData, "rationale"), escalation: opt(formData, "escalation"),
    });
    return "ok=note";
  });
}

export async function deleteNoteAction(formData: FormData): Promise<void> {
  const s = await actor();
  const id = requestId(formData);
  const revision = intOr(formData, "revision", id);
  const noteNo = intOr(formData, "noteNo", id, 1);
  await run(id, async () => {
    await reviewService().deleteNote(s.userId, id, revision, noteNo);
    return "ok=note";
  });
}

export async function publishAction(formData: FormData): Promise<void> {
  const s = await actor();
  const id = requestId(formData);
  const revision = intOr(formData, "revision", id);
  let status: string;
  try {
    status = (await reviewService().publish(s.userId, id, {
      revision, outcome: str(formData, "outcome") as "WITH_NOTES",
      noNotesDeclared: formData.get("noNotesDeclared") === "yes", attest: formData.get("attest") === "yes",
      noConflict: formData.get("noConflict") === "yes",
    })).status;
  } catch (e) {
    if (e instanceof ReviewError) redirect(page(id, `?e=${e.code}${e.reason ? `&r=${e.reason}` : ""}`));
    throw e;
  }
  redirect(afterPublishPath(status));
}

async function assignment(formData: FormData, mode: "assign" | "reassign"): Promise<never> {
  const s = await actor();
  const back = s.roles.includes("platform_admin") ? "/admin/routing" : "/partner";
  const id = formUuid(formData, "requestId");
  const reviewer = formUuid(formData, "reviewerId");
  if (!id || !reviewer) redirect(`${back}?${INVALID}`);
  try {
    if (mode === "assign") await reviewService().assign(s.userId, id, reviewer);
    else await reviewService().reassign(s.userId, id, reviewer);
  } catch (e) {
    if (e instanceof ReviewError) redirect(`${back}?e=${e.code}`);
    throw e;
  }
  redirect(`${back}?ok=assigned`);
}

export async function reassignAction(formData: FormData): Promise<void> {
  await assignment(formData, "reassign");
}

export async function assignAction(formData: FormData): Promise<void> {
  await assignment(formData, "assign");
}

// Koordinator mencatat bahwa firmanya memiliki konflik kepentingan dengan pemilik dokumen permintaan ini.
export async function declareConflictAction(formData: FormData): Promise<void> {
  const s = await actor();
  const id = formUuid(formData, "requestId");
  if (!id) redirect(`/partner?${INVALID}`);
  if (formData.get("confirm") !== "yes") redirect("/partner?e=CONFLICT_CONFIRM_REQUIRED");
  try {
    await reviewService().declareConflict(s.userId, id);
  } catch (e) {
    if (e instanceof ReviewError) redirect(`/partner?e=${e.code}`);
    throw e;
  }
  redirect("/partner?ok=conflict");
}

"use server";

import { redirect } from "next/navigation";
import { isUuid } from "@/lib/cases/pages";
import { casesService } from "@/lib/cases/runtime";
import { CaseError } from "@/lib/cases/service";
import { caseErrorText, parseQuoteForm } from "@/lib/cases/view";
import { getSessionRoles } from "@/lib/supabase/server";

const str = (f: FormData, k: string) => String(f.get(k) ?? "");

// Peran sesi hanya penyaring awal; wewenang sebenarnya (koordinator firma kasus) diperiksa ulang di database.
async function coordinator() {
  const s = await getSessionRoles();
  if (!s) redirect("/login");
  if (!s.roles.includes("partner_admin")) redirect("/partner");
  return s.userId;
}

async function run(id: string, fn: () => Promise<void>, ok: string): Promise<never> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof CaseError) redirect(`/partner/cases/${id}?e=${e.code}`);
    throw e;
  }
  redirect(`/partner/cases/${id}?ok=${ok}`);
}

export async function triageCaseAction(formData: FormData): Promise<void> {
  const actor = await coordinator();
  const id = str(formData, "caseId");
  if (!isUuid(id)) redirect("/partner/cases");
  await run(id, () => casesService().triage(actor, id, formData.get("conflictCleared") === "yes"), "triase");
}

export type QuoteState = { error?: string; values?: { amount: string; scope: string; expiresOn: string } };

export async function quoteCaseAction(_prev: QuoteState, formData: FormData): Promise<QuoteState> {
  const actor = await coordinator();
  const id = str(formData, "caseId");
  const values = { amount: str(formData, "amount"), scope: str(formData, "scope"), expiresOn: str(formData, "expiresOn") };
  if (!isUuid(id)) return { error: caseErrorText("NOT_FOUND")!, values };
  const parsed = parseQuoteForm(values);
  if (!parsed.ok) return { error: caseErrorText(parsed.code)!, values };
  try {
    await casesService().quote(actor, id, parsed.value);
  } catch (e) {
    if (e instanceof CaseError) return { error: caseErrorText(e.code)!, values };
    throw e;
  }
  redirect(`/partner/cases/${id}?ok=penawaran`);
}

export async function closeCaseAction(formData: FormData): Promise<void> {
  const actor = await coordinator();
  const id = str(formData, "caseId");
  if (!isUuid(id)) redirect("/partner/cases");
  await run(id, () => casesService().close(actor, id, str(formData, "reason")), "ditutup");
}

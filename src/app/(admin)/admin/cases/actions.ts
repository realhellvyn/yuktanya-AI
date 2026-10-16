"use server";

import { redirect } from "next/navigation";
import { isUuid } from "@/lib/cases/pages";
import { casesService } from "@/lib/cases/runtime";
import { CaseError } from "@/lib/cases/service";
import { getSessionRoles } from "@/lib/supabase/server";

const str = (f: FormData, k: string) => String(f.get(k) ?? "");

// Admin hanya merutekan kasus ke firma (operasional); triase dan penawaran tetap keputusan firma. Diperiksa ulang di database.
export async function routeCaseAction(formData: FormData): Promise<void> {
  const s = await getSessionRoles();
  if (!s || !s.roles.includes("platform_admin")) redirect("/login");
  const id = str(formData, "caseId");
  const firm = str(formData, "firmId");
  if (!isUuid(id) || !isUuid(firm)) redirect("/admin/cases?e=INVALID_FIRM");
  try {
    await casesService().route(s.userId, id, firm);
  } catch (e) {
    if (e instanceof CaseError) redirect(`/admin/cases?e=${e.code}`);
    throw e;
  }
  redirect("/admin/cases?ok=1");
}

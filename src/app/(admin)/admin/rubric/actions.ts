"use server";

import { redirect } from "next/navigation";
import { getPool } from "@/lib/db";
import { RUBRIC_VERSION } from "@/lib/deep/rubric";
import { getSessionRoles } from "@/lib/supabase/server";

export async function approveRubricAction(formData: FormData): Promise<void> {
  const s = await getSessionRoles();
  if (!s || !s.roles.includes("platform_admin")) redirect("/login");
  const ref = String(formData.get("signoffRef") ?? "").trim();
  if (ref.length < 3) redirect("/admin/rubric?e=SIGNOFF");
  await getPool().query("select admin_approve_rubric($1, $2, $3, $4)", [s.userId, RUBRIC_VERSION, ref, new Date()]);
  redirect("/admin/rubric?ok=1");
}

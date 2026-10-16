"use server";

import { redirect } from "next/navigation";
import { getPool } from "@/lib/db";
import { getSessionRoles } from "@/lib/supabase/server";

// Pemeriksaan ulang di server dan di fungsi SQL (set_feature_plan memeriksa peran platform_admin).
export async function setFeatureAction(formData: FormData): Promise<void> {
  const s = await getSessionRoles();
  if (!s || !s.roles.includes("platform_admin")) redirect("/admin");
  const feature = String(formData.get("feature") ?? "");
  const plan = String(formData.get("plan") ?? "");
  const enabled = String(formData.get("enabled")) === "true";
  await getPool().query("select set_feature_plan($1, $2, $3, $4)", [s.userId, feature, plan, enabled]);
  redirect("/admin/features");
}

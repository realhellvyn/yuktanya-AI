"use server";

import { redirect } from "next/navigation";
import { verificationService } from "@/lib/verification/runtime";
import { VerificationError, type RevokeReason } from "@/lib/verification/service";
import { getSessionRoles } from "@/lib/supabase/server";

export async function revokeVerificationAction(formData: FormData): Promise<void> {
  const s = await getSessionRoles();
  if (!s || !s.roles.includes("platform_admin")) redirect("/login");
  const id = String(formData.get("id") ?? "");
  const reason = String(formData.get("reason") ?? "") as RevokeReason;
  const note = String(formData.get("note") ?? "").trim();
  if (note.length < 5) redirect("/admin/verifications?e=NOTE");
  try {
    await verificationService().revoke(s.userId, id, reason, note);
  } catch (e) {
    if (e instanceof VerificationError) redirect(`/admin/verifications?e=${e.code}`);
    throw e;
  }
  redirect("/admin/verifications?ok=1");
}

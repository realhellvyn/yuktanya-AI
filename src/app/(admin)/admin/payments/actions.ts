"use server";

import { redirect } from "next/navigation";
import { billingService } from "@/lib/billing/runtime";
import { BillingError } from "@/lib/billing/service";
import { getSessionRoles } from "@/lib/supabase/server";

export async function confirmManualAction(formData: FormData): Promise<void> {
  const s = await getSessionRoles();
  if (!s || !s.roles.includes("platform_admin")) redirect("/login");
  const amount = Number(formData.get("amountIdr"));
  const bankRef = String(formData.get("bankRef") ?? "").trim();
  if (!Number.isInteger(amount) || amount <= 0 || bankRef.length < 3) redirect("/admin/payments?e=INVALID");
  try {
    const r = await billingService().confirmManual(s.userId, String(formData.get("paymentId") ?? ""), bankRef, amount);
    redirect(`/admin/payments?r=${r}`);
  } catch (e) {
    if (e instanceof BillingError) redirect(`/admin/payments?e=${e.code}`);
    throw e;
  }
}

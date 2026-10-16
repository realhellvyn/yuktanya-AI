"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { billingService } from "@/lib/billing/runtime";
import { adminPaymentErrorCode } from "@/lib/billing/admin-messages";
import { getSessionRoles } from "@/lib/supabase/server";

export async function confirmManualAction(formData: FormData): Promise<void> {
  const s = await getSessionRoles();
  if (!s || !s.roles.includes("platform_admin")) redirect("/login");
  const amount = Number(formData.get("amountIdr"));
  const bankRef = String(formData.get("bankRef") ?? "").trim();
  if (!Number.isInteger(amount) || amount <= 0 || bankRef.length < 3) redirect("/admin/payments?e=INVALID");
  try {
    const rec = String(formData.get("receivedAt") ?? "");
    const receivedAt = rec ? new Date(`${rec}:00+07:00`) : null;
    if (receivedAt && (Number.isNaN(receivedAt.getTime()) || receivedAt.getTime() > Date.now())) redirect("/admin/payments?e=INVALID");
    const r = await billingService().confirmManual(s.userId, String(formData.get("paymentId") ?? ""), bankRef, amount, receivedAt);
    redirect(`/admin/payments?r=${r}`);
  } catch (e) {
    unstable_rethrow(e);
    // Kode saja di alamat; halaman memetakannya ke kalimat tetap. Galat tak terduga dilempar ulang (halaman galat).
    const code = adminPaymentErrorCode(e);
    if (code) redirect(`/admin/payments?e=${code}`);
    throw e;
  }
}

export async function resolveReconciliationAction(formData: FormData): Promise<void> {
  const s = await getSessionRoles();
  if (!s || !s.roles.includes("platform_admin")) redirect("/login");
  const action = String(formData.get("action") ?? "");
  if (!["ACTIVATE", "REFUND_RECORDED", "CLOSE"].includes(action)) redirect("/admin/payments?e=INVALID");
  try {
    const r = await billingService().resolveReconciliation(s.userId, String(formData.get("orderId") ?? ""), action as "CLOSE", String(formData.get("note") ?? ""));
    redirect(`/admin/payments?r=${r}`);
  } catch (e) {
    unstable_rethrow(e);
    // Kode saja di alamat; halaman memetakannya ke kalimat tetap. Galat tak terduga dilempar ulang (halaman galat).
    const code = adminPaymentErrorCode(e);
    if (code) redirect(`/admin/payments?e=${code}`);
    throw e;
  }
}

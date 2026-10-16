"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { BillingError } from "@/lib/billing/service";
import { billingService } from "@/lib/billing/runtime";
import { requireUserId } from "@/lib/documents/session";
import { flags } from "@/lib/flags";

const str = (f: FormData, k: string) => String(f.get(k) ?? "");

export async function startMembershipAction(): Promise<void> {
  const userId = await requireUserId();
  const o = await billingService().createOrder(userId, "MEMBERSHIP_MONTHLY", null, randomUUID());
  redirect(`/checkout/${o.orderId}`);
}

// Harga selalu dihitung server dari paket pengguna; formulir hanya membawa ID versi.
export async function requestReviewAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const versionId = str(formData, "versionId");
  try {
    const o = await billingService().createOrder(userId, "STANDARD_REVIEW", versionId, randomUUID());
    redirect(o.status === "PAID" ? "/reviews?dibuat=1" : `/checkout/${o.orderId}`);
  } catch (e) {
    if (e instanceof BillingError && e.code === "ALREADY_REVIEWED") redirect("/reviews?notice=sudah");
    if (e instanceof BillingError && e.code === "NOT_FOUND") redirect("/documents");
    throw e;
  }
}

export async function payAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const orderId = str(formData, "orderId");
  const provider = str(formData, "provider");
  try {
    await billingService().startPayment(userId, orderId, provider);
  } catch (e) {
    if (e instanceof BillingError) redirect(`/checkout/${orderId}?notice=${e.code}`);
    throw e;
  }
  redirect(`/checkout/${orderId}`);
}

// Hanya non-produksi: adapter mock tidak terdaftar di produksi sehingga pembayaran mock tidak pernah ada.
export async function mockSettleAction(formData: FormData): Promise<void> {
  if (process.env.NODE_ENV === "production") redirect("/dashboard");
  const userId = await requireUserId();
  const orderId = str(formData, "orderId");
  await billingService().mockSettle(userId, str(formData, "paymentId"));
  redirect(`/checkout/${orderId}`);
}

// Deep Review hanya dari pemeriksaan standar yang memenuhi syarat; kelayakan dan harga diputuskan di database.
export async function requestDeepAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const parent = str(formData, "parentRequestId");
  if (!flags.deepReviewPurchase) redirect(`/reviews/${parent}`);
  try {
    const o = await billingService().createOrder(userId, "DEEP_REVIEW", parent, randomUUID());
    redirect(`/checkout/${o.orderId}`);
  } catch (e) {
    if (e instanceof BillingError) redirect(`/reviews/${parent}?notice=${e.code === "NOT_ELIGIBLE" ? e.reason : e.code}`);
    throw e;
  }
}

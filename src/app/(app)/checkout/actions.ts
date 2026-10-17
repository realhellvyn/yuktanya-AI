"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { BillingError } from "@/lib/billing/service";
import { MidtransError, midtransConfig } from "@/lib/billing/midtrans";
import { billingService } from "@/lib/billing/runtime";
import { createRateLimiter } from "@/lib/vault/rate-limit";
import { requireUserId } from "@/lib/documents/session";
import { flags } from "@/lib/flags";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
    if (e instanceof BillingError && e.code === "SPECIAL_CASE_OPEN") redirect("/cases?notice=khusus");
    if (e instanceof BillingError && e.code === "NOT_FOUND") redirect("/documents");
    throw e;
  }
}

// Pengguna hanya membayar lewat Midtrans; mock hanya di luar produksi. Transfer manual tidak lagi diterima dari formulir.
export async function payAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const orderId = str(formData, "orderId");
  if (!UUID.test(orderId)) redirect("/dashboard");
  const provider = str(formData, "provider");
  const allowed = provider === "midtrans" || (provider === "mock" && process.env.NODE_ENV !== "production");
  if (!allowed) redirect(`/checkout/${orderId}?notice=PROVIDER_UNAVAILABLE`);
  let target: string | undefined;
  try {
    target = (await billingService().startPayment(userId, orderId, provider)).redirectUrl;
  } catch (e) {
    if (e instanceof BillingError) redirect(`/checkout/${orderId}?notice=${e.code}`);
    throw e;
  }
  // Hanya halaman bayar Midtrans (asal divalidasi sekali lagi terhadap konfigurasi server) yang menjadi tujuan redirect.
  if (target) {
    const cfg = midtransConfig();
    let origin: string | null = null;
    try {
      origin = new URL(target).origin;
    } catch {
      origin = null;
    }
    if (cfg && origin && cfg.redirectOrigins.includes(origin)) redirect(target);
    // Tidak pernah diam-diam kembali ke checkout: tujuan di luar asal Midtrans aktif = galat penyedia dengan pemberitahuan.
    console.error("redirect_url di luar asal Midtrans aktif ditolak", orderId);
    redirect(`/checkout/${orderId}?notice=PROVIDER_ERROR`);
  }
  redirect(`/checkout/${orderId}`);
}

// "Perbarui status": bertanya ke API status Midtrans untuk pembayaran PENDING milik pengguna (sumber yang sama dengan
// webhook). Dibatasi per pengguna agar tidak membanjiri API.
const refreshLimiter = createRateLimiter({ limit: 6, windowMs: 60_000 });
export async function refreshPaymentAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const orderId = str(formData, "orderId");
  if (!UUID.test(orderId)) redirect("/dashboard");
  const cfg = midtransConfig();
  if (!cfg) redirect(`/checkout/${orderId}?notice=PROVIDER_UNAVAILABLE`);
  if (!refreshLimiter.allow(userId)) redirect(`/checkout/${orderId}?notice=RATE_LIMITED`);
  try {
    await billingService().refreshHosted(userId, orderId, cfg);
  } catch (e) {
    if (e instanceof MidtransError) {
      console.error("perbarui status Midtrans gagal", e.code);
      redirect(`/checkout/${orderId}?notice=STATUS_UNAVAILABLE`);
    }
    throw e;
  }
  redirect(`/checkout/${orderId}?notice=REFRESHED`);
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
  // ID tidak valid tidak boleh sampai ke DB (akan 500): kembali ke daftar dengan pemberitahuan.
  if (!UUID.test(parent)) redirect("/reviews?notice=deep-tidak-valid");
  if (!flags.deepReviewPurchase) redirect(`/reviews/${parent}`);
  try {
    const o = await billingService().createOrder(userId, "DEEP_REVIEW", parent, randomUUID());
    redirect(`/checkout/${o.orderId}`);
  } catch (e) {
    if (e instanceof BillingError) redirect(`/reviews/${parent}?notice=${e.code === "NOT_ELIGIBLE" ? e.reason : e.code}`);
    throw e;
  }
}

import "server-only";
import { homeFor } from "@/lib/auth/permissions";
import { getPool } from "@/lib/db";
import { flags } from "@/lib/flags";
import { ForbiddenError } from "@/lib/documents/handlers";
import { getSessionRoles } from "@/lib/supabase/server";
import { appOrigin } from "@/lib/app-url";
import { createRateLimiter } from "@/lib/vault/rate-limit";
import { createManualAdapter, createMidtransAdapter, createMockAdapter } from "./adapters";
import { midtransConfig } from "./midtrans";
import type { BillingDeps } from "./handlers";
import { createPgBillingService, type BillingService } from "./service";

const production = () => process.env.NODE_ENV === "production";
let cached: BillingService | undefined;
// Midtrans hanya terdaftar bila MIDTRANS_SERVER_KEY ada (server saja; tanpa kunci → "Pembayaran belum tersedia").
// Manual tetap terdaftar untuk pembayaran manual lama (pengguna tidak dapat lagi memilihnya; lihat payHandler/payAction).
export const billingService = (): BillingService => {
  if (cached) return cached;
  const mt = midtransConfig();
  return (cached = createPgBillingService(getPool(), [
    ...(production() ? [] : [createMockAdapter()]),
    createManualAdapter(process.env.MANUAL_PAYMENT_INSTRUCTIONS),
    ...(mt ? [createMidtransAdapter(mt, () => appOrigin())] : []),
  ]));
};
// Per proses: notifikasi Midtrans sah jauh di bawah batas ini; pembatas mencegah banjir permintaan ke API status.
const webhookLimiter = createRateLimiter({ limit: 120, windowMs: 60_000 });

export function billingDeps(): BillingDeps {
  return {
    getUserId: async () => {
      const s = await getSessionRoles();
      if (!s) return null;
      if (homeFor(s.roles) !== "/dashboard") throw new ForbiddenError();
      return s.userId;
    },
    getAdminId: async () => {
      const s = await getSessionRoles();
      if (!s) return null;
      if (!s.roles.includes("platform_admin")) throw new ForbiddenError();
      return s.userId;
    },
    service: billingService(),
    production: production(),
    deepEnabled: flags.deepReviewPurchase,
    midtrans: { config: midtransConfig(), limiter: webhookLimiter },
  };
}

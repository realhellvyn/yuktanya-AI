import "server-only";
import { homeFor } from "@/lib/auth/permissions";
import { getPool } from "@/lib/db";
import { flags } from "@/lib/flags";
import { ForbiddenError } from "@/lib/documents/handlers";
import { getSessionRoles } from "@/lib/supabase/server";
import { createManualAdapter, createMockAdapter } from "./adapters";
import type { BillingDeps } from "./handlers";
import { createPgBillingService, type BillingService } from "./service";

const production = () => process.env.NODE_ENV === "production";
let cached: BillingService | undefined;
export const billingService = (): BillingService =>
  (cached ??= createPgBillingService(getPool(), [
    ...(production() ? [] : [createMockAdapter()]),
    createManualAdapter(process.env.MANUAL_PAYMENT_INSTRUCTIONS),
  ]));

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
  };
}

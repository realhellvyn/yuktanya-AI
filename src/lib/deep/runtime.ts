import "server-only";
import { getPool } from "@/lib/db";
import { flags } from "@/lib/flags";
import { getSessionRoles } from "@/lib/supabase/server";
import type { DeepDeps } from "./handlers";
import { createPgDeepService, type DeepService } from "./service";

let cached: DeepService | undefined;
export const deepService = (): DeepService => (cached ??= createPgDeepService(getPool()));
export const deepDeps = (): DeepDeps => ({
  getActor: async () => {
    const s = await getSessionRoles();
    return s ? { userId: s.userId, roles: s.roles } : null;
  },
  service: deepService(),
  flags: { deepReviewPurchase: flags.deepReviewPurchase, enhancedIssuance: flags.enhancedIssuance },
});

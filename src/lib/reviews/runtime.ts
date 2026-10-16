import "server-only";
import { getPool } from "@/lib/db";
import { getSessionRoles } from "@/lib/supabase/server";
import type { ReviewDeps } from "./handlers";
import { createPgReviewService, type ReviewService } from "./service";

let cached: ReviewService | undefined;
export const reviewService = (): ReviewService => (cached ??= createPgReviewService(getPool()));
export const reviewDeps = (): ReviewDeps => ({
  getActor: async () => {
    const s = await getSessionRoles();
    return s ? { userId: s.userId, roles: s.roles } : null;
  },
  service: reviewService(),
});

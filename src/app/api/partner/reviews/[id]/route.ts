import { openReviewHandler } from "@/lib/reviews/handlers";
import { reviewDeps } from "@/lib/reviews/runtime";

export const GET = async (req: Request, ctx: { params: Promise<{ id: string }> }) => openReviewHandler(reviewDeps(), req, await ctx.params);

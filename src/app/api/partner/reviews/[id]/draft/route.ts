import { saveDraftHandler } from "@/lib/reviews/handlers";
import { reviewDeps } from "@/lib/reviews/runtime";

export const PUT = async (req: Request, ctx: { params: Promise<{ id: string }> }) => saveDraftHandler(reviewDeps(), req, await ctx.params);

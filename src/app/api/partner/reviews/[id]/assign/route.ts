import { assignHandler } from "@/lib/reviews/handlers";
import { reviewDeps } from "@/lib/reviews/runtime";

export const POST = async (req: Request, ctx: { params: Promise<{ id: string }> }) => assignHandler(reviewDeps(), req, await ctx.params);

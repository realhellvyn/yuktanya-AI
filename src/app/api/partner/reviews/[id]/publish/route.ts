import { publishHandler } from "@/lib/reviews/handlers";
import { reviewDeps } from "@/lib/reviews/runtime";

export const POST = async (req: Request, ctx: { params: Promise<{ id: string }> }) => publishHandler(reviewDeps(), req, await ctx.params);

import { upsertNoteHandler } from "@/lib/reviews/handlers";
import { reviewDeps } from "@/lib/reviews/runtime";

export const POST = async (req: Request, ctx: { params: Promise<{ id: string }> }) => upsertNoteHandler(reviewDeps(), req, await ctx.params);

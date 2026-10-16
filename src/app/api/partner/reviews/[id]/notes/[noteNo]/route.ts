import { deleteNoteHandler } from "@/lib/reviews/handlers";
import { reviewDeps } from "@/lib/reviews/runtime";

export const DELETE = async (req: Request, ctx: { params: Promise<{ id: string; noteNo: string }> }) => deleteNoteHandler(reviewDeps(), req, await ctx.params);

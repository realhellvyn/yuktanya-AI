import { saveDraftHandler } from "@/lib/documents/handlers";
import { documentsDeps } from "@/lib/documents/runtime";

export const PUT = async (req: Request, ctx: { params: Promise<{ id: string }> }) => saveDraftHandler(documentsDeps(), req, await ctx.params);

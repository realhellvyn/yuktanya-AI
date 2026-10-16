import { freezeHandler } from "@/lib/documents/handlers";
import { documentsDeps } from "@/lib/documents/runtime";

export const POST = async (req: Request, ctx: { params: Promise<{ id: string }> }) => freezeHandler(documentsDeps(), req, await ctx.params);

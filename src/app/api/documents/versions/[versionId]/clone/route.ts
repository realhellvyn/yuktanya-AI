import { cloneHandler } from "@/lib/documents/handlers";
import { documentsDeps } from "@/lib/documents/runtime";

export const POST = async (req: Request, ctx: { params: Promise<{ versionId: string }> }) => cloneHandler(documentsDeps(), req, await ctx.params);

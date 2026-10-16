import { diffHandler } from "@/lib/documents/handlers";
import { documentsDeps } from "@/lib/documents/runtime";

export const GET = async (req: Request, ctx: { params: Promise<{ versionId: string }> }) => diffHandler(documentsDeps(), req, await ctx.params);

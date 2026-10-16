import { getDocumentHandler } from "@/lib/documents/handlers";
import { documentsDeps } from "@/lib/documents/runtime";

export const GET = async (req: Request, ctx: { params: Promise<{ id: string }> }) => getDocumentHandler(documentsDeps(), req, await ctx.params);

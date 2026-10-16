import { downloadHandler } from "@/lib/documents/handlers";
import { documentsDeps } from "@/lib/documents/runtime";

export const GET = async (req: Request, ctx: { params: Promise<{ exportId: string }> }) => downloadHandler(documentsDeps(), req, await ctx.params);

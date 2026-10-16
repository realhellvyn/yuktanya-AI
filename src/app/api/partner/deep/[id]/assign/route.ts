import { assignDeepHandler } from "@/lib/deep/handlers";
import { deepDeps } from "@/lib/deep/runtime";

export const POST = async (req: Request, ctx: { params: Promise<Record<string, string>> }) => assignDeepHandler(deepDeps(), req, await ctx.params);

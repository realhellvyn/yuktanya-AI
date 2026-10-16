import { openDeepHandler } from "@/lib/deep/handlers";
import { deepDeps } from "@/lib/deep/runtime";

export const GET = async (req: Request, ctx: { params: Promise<Record<string, string>> }) => openDeepHandler(deepDeps(), req, await ctx.params);

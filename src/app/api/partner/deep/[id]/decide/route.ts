import { decideHandler } from "@/lib/deep/handlers";
import { deepDeps } from "@/lib/deep/runtime";

export const POST = async (req: Request, ctx: { params: Promise<Record<string, string>> }) => decideHandler(deepDeps(), req, await ctx.params);

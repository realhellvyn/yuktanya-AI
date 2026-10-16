import { setDispositionHandler } from "@/lib/deep/handlers";
import { deepDeps } from "@/lib/deep/runtime";

export const PUT = async (req: Request, ctx: { params: Promise<Record<string, string>> }) => setDispositionHandler(deepDeps(), req, await ctx.params);

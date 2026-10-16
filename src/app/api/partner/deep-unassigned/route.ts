import { deepUnassignedHandler } from "@/lib/deep/handlers";
import { deepDeps } from "@/lib/deep/runtime";

export const GET = async (req: Request, ctx: { params: Promise<Record<string, string>> }) => deepUnassignedHandler(deepDeps(), req, await ctx.params);

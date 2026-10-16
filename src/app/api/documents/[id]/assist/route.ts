import { handleAssist } from "@/lib/ai/assist";
import { assistDeps } from "@/lib/vault/runtime";

export const POST = async (req: Request, ctx: { params: Promise<{ id: string }> }) => handleAssist(assistDeps(), req, await ctx.params);

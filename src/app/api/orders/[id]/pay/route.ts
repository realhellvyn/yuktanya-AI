import { payHandler } from "@/lib/billing/handlers";
import { billingDeps } from "@/lib/billing/runtime";

export const POST = async (req: Request, ctx: { params: Promise<{ id: string }> }) => payHandler(billingDeps(), req, await ctx.params);

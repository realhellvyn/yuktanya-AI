import { webhookHandler } from "@/lib/billing/handlers";
import { billingDeps } from "@/lib/billing/runtime";

export const POST = async (req: Request, ctx: { params: Promise<{ provider: string }> }) => webhookHandler(billingDeps(), req, await ctx.params);

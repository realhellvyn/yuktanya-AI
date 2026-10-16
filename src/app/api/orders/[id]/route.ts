import { getOrderHandler } from "@/lib/billing/handlers";
import { billingDeps } from "@/lib/billing/runtime";

export const GET = async (req: Request, ctx: { params: Promise<{ id: string }> }) => getOrderHandler(billingDeps(), req, await ctx.params);

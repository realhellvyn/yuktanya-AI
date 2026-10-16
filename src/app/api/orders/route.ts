import { createOrderHandler } from "@/lib/billing/handlers";
import { billingDeps } from "@/lib/billing/runtime";

export const POST = (req: Request) => createOrderHandler(billingDeps(), req);

import { getPool } from "@/lib/db";
import { outboxJobHandler } from "@/lib/vault/handlers";
import { emailSender } from "@/lib/vault/runtime";

export const POST = (req: Request) => outboxJobHandler({ pool: getPool(), sender: emailSender(), secret: process.env.CRON_SECRET }, req);

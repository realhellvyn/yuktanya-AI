import { expireOrdersJobHandler } from "@/lib/billing/jobs";
import { getPool } from "@/lib/db";

const run = (req: Request) => expireOrdersJobHandler({ pool: getPool(), secret: process.env.CRON_SECRET }, req);

export const POST = run;
// Vercel Cron memanggil dengan GET dan header "Authorization: Bearer $CRON_SECRET" (sama seperti job outbox dan retensi).
export const GET = run;

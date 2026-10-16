import { getPool } from "@/lib/db";
import { retentionJobHandler } from "@/lib/retention/retention";

const run = (req: Request) => retentionJobHandler({ pool: getPool(), secret: process.env.CRON_SECRET }, req);

export const POST = run;
// Vercel Cron memanggil dengan GET dan header "Authorization: Bearer $CRON_SECRET" (sama seperti job outbox).
export const GET = run;

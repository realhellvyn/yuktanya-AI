import { documentsDeps } from "@/lib/documents/runtime";
import { getPool } from "@/lib/db";
import { getBlobStore } from "@/lib/documents/runtime";
import { evidenceDownloadHandler } from "@/lib/vault/handlers";

export const GET = async (req: Request, ctx: { params: Promise<{ packId: string }> }) =>
  evidenceDownloadHandler({ getUserId: documentsDeps().getUserId, pool: getPool(), blob: getBlobStore() }, req, await ctx.params);

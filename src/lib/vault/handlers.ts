import type { Pool } from "pg";
import type { BlobStore } from "@/lib/documents/blob";
import { ForbiddenError } from "@/lib/documents/handlers";
import { IntegrityError } from "@/lib/documents/service";
import { cronAuthError } from "@/lib/jobs/cron-auth";
import { downloadEvidencePack } from "./evidence";
import { processOutbox, type EmailSender } from "./outbox";

const json = (body: unknown, status = 200) => Response.json(body, { status });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Dipanggil penjadwal (cron). Tanpa rahasia terkonfigurasi atau pengirim email nyata, endpoint menolak (503).
export async function outboxJobHandler(deps: { pool: Pool; sender: EmailSender | null; secret?: string }, req: Request): Promise<Response> {
  if (!deps.secret || deps.secret.length < 16) return json({ code: "NOT_CONFIGURED" }, 503);
  if (!deps.sender) return json({ code: "NO_EMAIL_PROVIDER" }, 503);
  const denied = cronAuthError(deps.secret, req);
  if (denied) return denied;
  return json(await processOutbox(deps.pool, deps.sender));
}

export async function evidenceDownloadHandler(
  deps: { getUserId: () => Promise<string | null>; pool: Pool; blob: BlobStore },
  _req: Request,
  params: { packId: string },
): Promise<Response> {
  let userId: string | null;
  try {
    userId = await deps.getUserId();
  } catch (e) {
    if (e instanceof ForbiddenError) return json({ code: "FORBIDDEN" }, 403);
    throw e;
  }
  if (!userId) return json({ code: "AUTH_REQUIRED" }, 401);
  if (!UUID.test(params.packId)) return json({ code: "NOT_FOUND" }, 404);
  try {
    const f = await downloadEvidencePack({ pool: deps.pool, blob: deps.blob }, userId, params.packId);
    if (!f) return json({ code: "NOT_FOUND" }, 404);
    return new Response(f.bytes as BodyInit, {
      status: 200,
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${f.filename}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof IntegrityError) return json({ code: "INTEGRITY_ERROR" }, 500);
    throw e;
  }
}

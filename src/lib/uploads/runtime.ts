import "server-only";
import { createPgUsageStore } from "@/lib/ai/quota";
import { recordEvent } from "@/lib/analytics/events";
import { getPool } from "@/lib/db";
import { getBlobStore } from "@/lib/documents/runtime";
import { chatTurnDeps } from "@/lib/vault/runtime";
import type { UploadDeps } from "./handler";
import { createPgUploadRepo } from "./repo";

let repo: ReturnType<typeof createPgUploadRepo> | undefined;
export const uploadRepo = () => (repo ??= createPgUploadRepo(getPool()));

export function uploadDeps(): UploadDeps {
  const store = createPgUsageStore(getPool());
  return {
    getUserId: chatTurnDeps().getUserId,
    plan: async (userId, now) => {
      const s = await store.snapshot(userId, now);
      return { plan: s.plan, documentsRemaining: s.documentsRemaining, resetAt: s.resetAt };
    },
    blob: getBlobStore(),
    save: (i) => uploadRepo().save(i),
    record: (e) => recordEvent(getPool(), e),
  };
}

import "server-only";
import { createPgUsageStore } from "@/lib/ai/quota";
import { recordEvent } from "@/lib/analytics/events";
import { getPool } from "@/lib/db";
import { getBlobStore } from "@/lib/documents/runtime";
import { chatTurnDeps } from "@/lib/vault/runtime";
import type { UploadDeps } from "./handler";
import { extractUploadTextIsolated } from "./parse-isolated";
import { createPgUploadRepo } from "./repo";

let repo: ReturnType<typeof createPgUploadRepo> | undefined;
export const uploadRepo = () => (repo ??= createPgUploadRepo(getPool()));

export function uploadDeps(): UploadDeps {
  const store = createPgUsageStore(getPool());
  return {
    getUserId: chatTurnDeps().getUserId,
    plan: async (userId, now) => {
      const s = await store.snapshot(userId, now);
      return { plan: s.plan, documentsRemaining: s.documentsRemaining, aiReviewsRemaining: s.aiReviewsRemaining, messagesRemaining: s.messagesRemaining, resetAt: s.resetAt };
    },
    blob: getBlobStore(),
    save: (i) => uploadRepo().save(i),
    // Task 24 (A05): pembacaan berkas selalu di worker terpisah dengan batas waktu keras.
    parse: (kind, bytes, limits) => extractUploadTextIsolated(kind, bytes, limits),
    record: (e) => recordEvent(getPool(), e),
  };
}

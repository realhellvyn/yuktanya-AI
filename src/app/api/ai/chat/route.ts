import { chat } from "@/lib/ai/gateway";
import { createChatCache, handleChat } from "@/lib/ai/handle-chat";
import { createPgUsageStore } from "@/lib/ai/quota";
import { recordEvent } from "@/lib/analytics/events";
import { getPool } from "@/lib/db";
import { getSessionRoles } from "@/lib/supabase/server";

const cache = createChatCache();
const inflight = new Set<string>();

export async function POST(req: Request) {
  const pool = getPool();
  return handleChat(
    {
      getUserId: async () => (await getSessionRoles())?.userId ?? null,
      store: createPgUsageStore(pool),
      chat,
      cache,
      inflight,
      recordMetric: (m) =>
        recordEvent(pool, {
          name: m.status === "SUCCESS" ? "ai_request_succeeded" : "ai_request_failed",
          actorUserId: m.userId,
          entityType: "ai_request",
          entityId: m.requestId,
          dedupeKey: `ai:${m.requestId}:${m.status}`,
          metadata: { latency_ms: m.latencyMs, ...(m.errorCode ? { error_code: m.errorCode } : {}) },
        }),
    },
    req,
  );
}

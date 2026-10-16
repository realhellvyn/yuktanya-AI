import { afterAll, describe, expect, it, vi } from "vitest";
import { createPgAttemptLimiter } from "@/lib/ai/attempts";
import { handleChatTurn, type ChatTurnDeps } from "@/lib/ai/chat-turn";
import { createPgDocumentsService } from "@/lib/documents/service";
import { createPgUsageStore } from "@/lib/ai/quota";
import { GatewayError } from "@/lib/ai/gateway";
import { createUser, getPool } from "./helpers";

const pool = getPool();
afterAll(() => pool.end());
const NOW = new Date("2026-10-16T05:00:00Z");

describe("ai_attempt_allowed / pembatas percobaan", () => {
  it("menolak setelah batas dalam jendela, pulih setelah jendela, dan terpisah per scope dan per user", async () => {
    const lim = createPgAttemptLimiter(pool, { chat: { limit: 3, windowSeconds: 600 }, assist: { limit: 1, windowSeconds: 600 } });
    const u = await createUser(pool);
    const v = await createUser(pool);
    const t = (s: number) => new Date(NOW.getTime() + s * 1000);
    expect([await lim.allow(u, "chat", NOW), await lim.allow(u, "chat", NOW), await lim.allow(u, "chat", NOW), await lim.allow(u, "chat", NOW)]).toEqual([true, true, true, false]);
    expect(await lim.allow(u, "assist", NOW)).toBe(true);
    expect(await lim.allow(v, "chat", NOW)).toBe(true);
    expect(await lim.allow(u, "chat", t(601))).toBe(true);
  });

  it("serentak: tidak melampaui batas", async () => {
    const lim = createPgAttemptLimiter(pool, { chat: { limit: 3, windowSeconds: 600 }, assist: { limit: 1, windowSeconds: 600 } });
    const u = await createUser(pool);
    const rs = await Promise.all(Array.from({ length: 8 }, () => lim.allow(u, "chat", NOW)));
    expect(rs.filter(Boolean)).toHaveLength(3);
  });
});

describe("percakapan dokumen memakai pembatas percobaan", () => {
  it("percobaan gagal tetap dihitung: setelah batas → 429 TOO_MANY_ATTEMPTS tanpa memanggil gateway", async () => {
    const u = await createUser(pool);
    const docs = createPgDocumentsService(pool, { ALLOW_UNAPPROVED_TEMPLATES: "true", NODE_ENV: "test" });
    const id = (await docs.create(u, "NDA", `k-${Math.random().toString(36).slice(2)}-abcdef`)).documentId;
    const chat = vi.fn(async () => { throw new GatewayError("TIMEOUT"); });
    const deps: ChatTurnDeps = {
      getUserId: async () => u, service: docs, store: createPgUsageStore(pool), pool, chat: chat as unknown as ChatTurnDeps["chat"], inflight: new Set(), now: () => NOW,
      attempts: createPgAttemptLimiter(pool, { chat: { limit: 2, windowSeconds: 600 }, assist: { limit: 1, windowSeconds: 600 } }),
    };
    const call = () => handleChatTurn(deps, new Request("http://t/x", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": `k-${Math.random().toString(36).slice(2)}-abcdef` }, body: JSON.stringify({ message: "Saya Sinta Dewi ingin NDA dengan Budi Santoso." }) }), { id });
    expect((await call()).status).toBe(502);
    expect((await call()).status).toBe(502);
    const third = await call();
    expect(third.status).toBe(429);
    expect((await third.json()).code).toBe("TOO_MANY_ATTEMPTS");
    expect(chat).toHaveBeenCalledTimes(2); // percobaan ketiga ditolak sebelum memanggil gateway
  });
});

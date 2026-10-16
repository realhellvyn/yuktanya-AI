import { z } from "zod";
import { GatewayError, type ChatMessage, type chat as gatewayChat } from "./gateway";
import type { UsageStore } from "./quota";

// Prompt sistem selalu dari server; pesan "system" dari klien ditolak.
const SYSTEM_PROMPT =
  "Anda adalah Yuktanya AI, asisten penyusunan dokumen berbahasa Indonesia. Jangan mengarang nama, jumlah, tanggal, fakta, " +
  "atau kutipan hukum. Tanyakan informasi yang belum ada. Anda bukan pengacara.";

const bodySchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(20_000) }))
    .min(1)
    .max(40),
});

export type ChatResult = { text: string; requestId: string };
export type ChatMetric = { requestId: string; userId: string; status: "SUCCESS" | "FAILED"; latencyMs: number; errorCode?: string };
export type ChatCache = Map<string, { result: ChatResult; expiresAt: number }>;
export const createChatCache = (): ChatCache => new Map();

export type ChatDeps = {
  getUserId: () => Promise<string | null>;
  store: UsageStore;
  chat: typeof gatewayChat;
  recordMetric: (m: ChatMetric) => Promise<void>;
  cache: ChatCache;
  now?: () => Date;
};

const CACHE_TTL_MS = 5 * 60_000;
const json = (body: unknown, status: number, headers?: Record<string, string>) => Response.json(body, { status, headers });

export async function handleChat(deps: ChatDeps, req: Request): Promise<Response> {
  const userId = await deps.getUserId();
  if (!userId) return json({ code: "AUTH_REQUIRED" }, 401);

  const key = req.headers.get("idempotency-key");
  if (!key || !/^[\x21-\x7e]{8,128}$/.test(key)) return json({ code: "INVALID_REQUEST" }, 400);
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ code: "INVALID_REQUEST" }, 400);

  const now = deps.now?.() ?? new Date();
  const cacheKey = `${userId}:${key}`;
  const cached = deps.cache.get(cacheKey);
  if (cached && cached.expiresAt > now.getTime()) return json(cached.result, 200);

  const reservation = await deps.store.reserve(userId, "MESSAGE", key, now);
  if (!reservation.ok) {
    const retryAfter = Math.max(1, Math.ceil((new Date(reservation.resetAt).getTime() - now.getTime()) / 1000));
    return json({ code: reservation.code, resetAt: reservation.resetAt }, 429, { "retry-after": String(retryAfter) });
  }
  // Duplikat tanpa hasil tersimpan (instance lain/cache habis): jangan memanggil gateway dan jangan menagih lagi.
  if (reservation.duplicate) return json({ code: "DUPLICATE_REQUEST" }, 409);

  const started = Date.now();
  const messages: ChatMessage[] = [{ role: "system", content: SYSTEM_PROMPT }, ...parsed.data.messages];
  try {
    const result = await deps.chat(messages);
    // Bila finalize gagal, jawaban tetap dikirim; reservasi tetap terhitung sampai kedaluwarsa (TTL).
    await deps.store.finalize(reservation.groupId).catch(() => undefined);
    deps.cache.set(cacheKey, { result, expiresAt: now.getTime() + CACHE_TTL_MS });
    await deps.recordMetric({ requestId: result.requestId, userId, status: "SUCCESS", latencyMs: Date.now() - started });
    return json(result, 200);
  } catch (err) {
    await deps.store.release(reservation.groupId);
    const code = err instanceof GatewayError ? err.code : "INTERNAL";
    await deps.recordMetric({ requestId: `failed-${key}`, userId, status: "FAILED", latencyMs: Date.now() - started, errorCode: code });
    if (err instanceof GatewayError) return json({ code: "AI_UNAVAILABLE", preserved: true }, 502);
    throw err;
  }
}

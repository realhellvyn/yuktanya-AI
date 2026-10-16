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
  // Satu panggilan upstream aktif per user (per proses); dibagikan lewat modul route.
  inflight: Set<string>;
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

  if (deps.inflight.has(userId)) return json({ code: "AI_BUSY" }, 429, { "retry-after": "2" });
  deps.inflight.add(userId);
  try {
    return await runChat(deps, userId, key, parsed.data.messages, cacheKey, now);
  } finally {
    deps.inflight.delete(userId);
  }
}

async function runChat(
  deps: ChatDeps,
  userId: string,
  key: string,
  clientMessages: ChatMessage[],
  cacheKey: string,
  now: Date,
): Promise<Response> {
  const reservation = await deps.store.reserve(userId, "MESSAGE", key, now);
  if (!reservation.ok) {
    const retryAfter = Math.max(1, Math.ceil((new Date(reservation.resetAt).getTime() - now.getTime()) / 1000));
    return json({ code: reservation.code, resetAt: reservation.resetAt }, 429, { "retry-after": String(retryAfter) });
  }
  // Duplikat tanpa hasil tersimpan (instance lain/cache habis): jangan memanggil gateway dan jangan menagih lagi.
  if (reservation.duplicate) return json({ code: "DUPLICATE_REQUEST" }, 409);

  const started = Date.now();
  const messages: ChatMessage[] = [{ role: "system", content: SYSTEM_PROMPT }, ...clientMessages];
  const metric = (m: Omit<ChatMetric, "userId" | "latencyMs">) =>
    deps.recordMetric({ ...m, userId, latencyMs: Date.now() - started }).catch(() => undefined);
  try {
    const result = await deps.chat(messages);
    // Finalisasi menolak reservasi yang sudah kedaluwarsa; jawaban tetap dikirim tanpa biaya dalam kasus langka itu.
    await deps.store.finalize(reservation.groupId, deps.now?.() ?? new Date()).catch(() => undefined);
    deps.cache.set(cacheKey, { result, expiresAt: now.getTime() + CACHE_TTL_MS });
    await metric({ requestId: result.requestId, status: "SUCCESS" });
    return json(result, 200);
  } catch (err) {
    await deps.store.release(reservation.groupId).catch(() => undefined);
    const code = err instanceof GatewayError ? err.code : "INTERNAL";
    await metric({ requestId: `failed-${userId}-${reservation.groupId}`, status: "FAILED", errorCode: code });
    if (err instanceof GatewayError) return json({ code: "AI_UNAVAILABLE", preserved: true }, 502);
    return json({ code: "INTERNAL" }, 500);
  }
}

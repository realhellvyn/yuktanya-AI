import "server-only";
import { createHash, randomUUID } from "node:crypto";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export type GatewayErrorCode = "TIMEOUT" | "RATE_LIMITED" | "UPSTREAM_5XX" | "BAD_RESPONSE" | "UNAVAILABLE";
export type GatewayEnv = { FREELLM_BASE_URL?: string; FREELLM_API_KEY?: string; AI_MOCK_MODE?: string; NODE_ENV?: string };

export class GatewayError extends Error {
  constructor(public readonly code: GatewayErrorCode, message?: string) {
    super(message ?? code);
    this.name = "GatewayError";
  }
}

const MAX_TEXT_CHARS = 200_000;
const MAX_BODY_CHARS = 1_000_000;
const DEFAULT_TIMEOUT_MS = 60_000;
// Task 24 (A04): satu percobaan (pertama, ulang, atau perbaikan JSON) hanya dimulai bila sisa tenggat giliran minimal
// 20 detik. Data produksi: p95 28 detik; percobaan yang lebih pendek hampir pasti terpotong dan hanya memperlama kegagalan.
export const MIN_ATTEMPT_MS = 20_000;

// deadline = batas waktu total (epoch ms) untuk seluruh giliran, termasuk ulang dan perbaikan. Batas waktu tiap percobaan
// dipotong ke sisa tenggat. now hanya untuk uji.
export type ChatOpts = { fetchImpl?: typeof fetch; timeoutMs?: number; env?: GatewayEnv; deadline?: number; now?: () => number };
type Opts = ChatOpts;

function mock(messages: ChatMessage[]) {
  const id = createHash("sha256").update(JSON.stringify(messages)).digest("hex").slice(0, 8);
  return { text: `[MOCK] ${id}`, requestId: `mock-${id}` };
}

async function readCapped(res: Response, maxChars: number): Promise<string> {
  if (!res.body) {
    const text = await res.text();
    if (text.length > maxChars) throw new GatewayError("BAD_RESPONSE");
    return text;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
    if (out.length > maxChars) {
      await reader.cancel().catch(() => undefined);
      throw new GatewayError("BAD_RESPONSE");
    }
  }
  return out + decoder.decode();
}

async function attempt(messages: ChatMessage[], base: string, key: string, f: typeof fetch, timeoutMs: number) {
  const controller = new AbortController();
  // Timer tetap hidup selama badan respons dibaca, bukan hanya sampai header tiba.
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Literal "auto" pada setiap panggilan; tidak ada pemilih model atau override env.
    const res = await f(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: "auto", messages }),
      signal: controller.signal,
    });
    if (res.status === 429) throw new GatewayError("RATE_LIMITED");
    if (res.status >= 500) throw new GatewayError("UPSTREAM_5XX");
    if (!res.ok) throw new GatewayError("UNAVAILABLE");

    const raw = await readCapped(res, MAX_BODY_CHARS);
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new GatewayError("BAD_RESPONSE");
    }
    if (!json || typeof json !== "object") throw new GatewayError("BAD_RESPONSE");
    const body = json as { id?: unknown; choices?: { message?: { content?: unknown } }[] };
    const text = body.choices?.[0]?.message?.content;
    if (typeof text !== "string" || text.length === 0 || text.length > MAX_TEXT_CHARS) throw new GatewayError("BAD_RESPONSE");
    const requestId = typeof body.id === "string" ? body.id : (res.headers.get("x-request-id") ?? randomUUID());
    return { text, requestId };
  } catch (err) {
    if (err instanceof GatewayError) throw err;
    if (err instanceof Error && err.name === "AbortError") throw new GatewayError("TIMEOUT");
    throw new GatewayError("UNAVAILABLE");
  } finally {
    clearTimeout(timer);
  }
}

export async function chat(messages: ChatMessage[], opts: Opts = {}): Promise<{ text: string; requestId: string }> {
  const env = opts.env ?? (process.env as GatewayEnv);
  if (env.AI_MOCK_MODE === "true") {
    if (env.NODE_ENV === "production") throw new GatewayError("UNAVAILABLE", "Mock mode tidak boleh aktif di produksi");
    return mock(messages);
  }
  const base = env.FREELLM_BASE_URL;
  const key = env.FREELLM_API_KEY;
  if (!base || !key) throw new GatewayError("UNAVAILABLE", "Gateway belum dikonfigurasi");

  const f = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = opts.now ?? Date.now;
  // null = sisa tenggat tidak cukup untuk satu percobaan bermakna (percobaan tidak dimulai).
  const budget = (): number | null => {
    if (opts.deadline === undefined) return timeoutMs;
    const left = opts.deadline - now();
    return left < MIN_ATTEMPT_MS ? null : Math.min(timeoutMs, left);
  };
  const first = budget();
  if (first === null) throw new GatewayError("TIMEOUT");
  try {
    return await attempt(messages, base, key, f, first);
  } catch (err) {
    // Satu percobaan ulang hanya untuk timeout/5xx; tidak untuk 429 agar tidak memperburuk rate limit.
    // Ulang tidak dimulai bila sisa tenggat giliran tidak cukup; galat asli yang dilaporkan.
    if (err instanceof GatewayError && (err.code === "TIMEOUT" || err.code === "UPSTREAM_5XX")) {
      const again = budget();
      if (again === null) throw err;
      return attempt(messages, base, key, f, again);
    }
    throw err;
  }
}

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

type Opts = { fetchImpl?: typeof fetch; timeoutMs?: number; env?: GatewayEnv };

function mock(messages: ChatMessage[]) {
  const id = createHash("sha256").update(JSON.stringify(messages)).digest("hex").slice(0, 8);
  return { text: `[MOCK] ${id}`, requestId: `mock-${id}` };
}

async function attempt(messages: ChatMessage[], base: string, key: string, f: typeof fetch, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    // Literal "auto" pada setiap panggilan; tidak ada pemilih model atau override env.
    res = await f(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: "auto", messages }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw new GatewayError("TIMEOUT");
    throw new GatewayError("UNAVAILABLE");
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 429) throw new GatewayError("RATE_LIMITED");
  if (res.status >= 500) throw new GatewayError("UPSTREAM_5XX");
  if (!res.ok) throw new GatewayError("UNAVAILABLE");

  const raw = await res.text();
  if (raw.length > MAX_BODY_CHARS) throw new GatewayError("BAD_RESPONSE");
  let json: { id?: unknown; choices?: { message?: { content?: unknown } }[] };
  try {
    json = JSON.parse(raw);
  } catch {
    throw new GatewayError("BAD_RESPONSE");
  }
  const text = json.choices?.[0]?.message?.content;
  if (typeof text !== "string" || text.length === 0 || text.length > MAX_TEXT_CHARS) throw new GatewayError("BAD_RESPONSE");
  const requestId = typeof json.id === "string" ? json.id : (res.headers.get("x-request-id") ?? randomUUID());
  return { text, requestId };
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
  try {
    return await attempt(messages, base, key, f, timeoutMs);
  } catch (err) {
    // Satu percobaan ulang hanya untuk timeout/5xx; tidak untuk 429 agar tidak memperburuk rate limit.
    if (err instanceof GatewayError && (err.code === "TIMEOUT" || err.code === "UPSTREAM_5XX")) {
      return attempt(messages, base, key, f, timeoutMs);
    }
    throw err;
  }
}

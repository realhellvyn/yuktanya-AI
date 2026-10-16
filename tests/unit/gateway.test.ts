import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GatewayError, chat } from "@/lib/ai/gateway";
import { flags } from "@/lib/flags";

const env = { FREELLM_BASE_URL: "https://gw.test/v1", FREELLM_API_KEY: "k-test" };
const msgs = [{ role: "user" as const, content: "halo" }];
const ok = (content = "jawab") =>
  new Response(JSON.stringify({ id: "req-1", choices: [{ message: { content } }] }), { status: 200 });

function fakeFetch(...responses: (Response | (() => Promise<Response>))[]) {
  const bodies: { model?: string }[] = [];
  let i = 0;
  const impl = (async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    const next = responses[Math.min(i++, responses.length - 1)];
    return typeof next === "function" ? next() : next.clone();
  }) as unknown as typeof fetch;
  return { impl, bodies };
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof GatewayError ? e.code : `OTHER:${String(e)}`;
  }
  return "NO_ERROR";
};

describe("gateway chat", () => {
  it("setiap request membawa model literal 'auto', termasuk retry", async () => {
    const f = fakeFetch(new Response("x", { status: 500 }), ok());
    await chat(msgs, { fetchImpl: f.impl, env });
    await chat(msgs, { fetchImpl: f.impl, env });
    await chat(msgs, { fetchImpl: f.impl, env });
    expect(f.bodies.length).toBeGreaterThanOrEqual(3);
    expect(f.bodies.every((b) => b.model === "auto")).toBe(true);
  });

  it("mengembalikan teks dan requestId dari gateway", async () => {
    const f = fakeFetch(ok("halo balik"));
    expect(await chat(msgs, { fetchImpl: f.impl, env })).toEqual({ text: "halo balik", requestId: "req-1" });
  });

  it("mock mode tidak memanggil fetch dan deterministik", async () => {
    const f = fakeFetch(ok());
    const a = await chat(msgs, { fetchImpl: f.impl, env: { AI_MOCK_MODE: "true" } });
    const b = await chat(msgs, { fetchImpl: f.impl, env: { AI_MOCK_MODE: "true" } });
    expect(f.bodies).toHaveLength(0);
    expect(a.text.startsWith("[MOCK]")).toBe(true);
    expect(a).toEqual(b);
  });

  it("mock mode ditolak di produksi", async () => {
    expect(await code(chat(msgs, { env: { AI_MOCK_MODE: "true", NODE_ENV: "production" } }))).toBe("UNAVAILABLE");
  });

  it("429 → RATE_LIMITED tanpa retry; 500 terus → UPSTREAM_5XX dengan 1 retry", async () => {
    const f429 = fakeFetch(new Response("", { status: 429 }));
    expect(await code(chat(msgs, { fetchImpl: f429.impl, env }))).toBe("RATE_LIMITED");
    expect(f429.bodies).toHaveLength(1);
    const f500 = fakeFetch(new Response("", { status: 503 }));
    expect(await code(chat(msgs, { fetchImpl: f500.impl, env }))).toBe("UPSTREAM_5XX");
    expect(f500.bodies).toHaveLength(2);
  });

  it("fetch menggantung → TIMEOUT pada timeoutMs", async () => {
    const hang = (async (_u: string, init: RequestInit) =>
      new Promise((_r, rej) => init.signal!.addEventListener("abort", () => rej(new DOMException("x", "AbortError"))))) as unknown as typeof fetch;
    expect(await code(chat(msgs, { fetchImpl: hang, env, timeoutMs: 20 }))).toBe("TIMEOUT");
  });

  it.each([
    ["HTML", "<html>oops</html>"],
    ["objek kosong", "{}"],
    ["choices kosong", JSON.stringify({ choices: [] })],
    ["konten kosong", JSON.stringify({ choices: [{ message: { content: "" } }] })],
    ["teks raksasa", JSON.stringify({ choices: [{ message: { content: "a".repeat(200_001) } }] })],
    ["null", "null"],
    ["angka", "123"],
    ["string JSON", '"x"'],
  ])("balasan %s → BAD_RESPONSE", async (_n, body) => {
    const f = fakeFetch(new Response(body, { status: 200 }));
    expect(await code(chat(msgs, { fetchImpl: f.impl, env }))).toBe("BAD_RESPONSE");
  });

  it("badan respons yang menggantung setelah header → TIMEOUT", async () => {
    const stall = (async (_u: string, init: RequestInit) =>
      new Response(
        new ReadableStream({
          start(c) {
            init.signal!.addEventListener("abort", () => c.error(new DOMException("x", "AbortError")));
          },
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
    expect(await code(chat(msgs, { fetchImpl: stall, env, timeoutMs: 30 }))).toBe("TIMEOUT");
  });

  it("badan respons raksasa dihentikan di batas dan dibatalkan", async () => {
    let cancelled = false;
    const huge = (async () =>
      new Response(
        new ReadableStream({
          pull(c) { c.enqueue(new TextEncoder().encode("a".repeat(400_000))); },
          cancel() { cancelled = true; },
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
    expect(await code(chat(msgs, { fetchImpl: huge, env }))).toBe("BAD_RESPONSE");
    expect(cancelled).toBe(true);
  });

  it("tanpa base URL/kunci → UNAVAILABLE", async () => {
    expect(await code(chat(msgs, { env: {} }))).toBe("UNAVAILABLE");
  });
});

describe("keamanan modul", () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = path.join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });

  it("gateway.ts server-only dan tidak ada override model lewat env di src", () => {
    expect(readFileSync("src/lib/ai/gateway.ts", "utf8")).toMatch(/import "server-only"/);
    for (const f of walk("src")) expect(readFileSync(f, "utf8")).not.toMatch(/FREELLM_MODEL/);
  });

  it("kunci rahasia tidak dirujuk dari berkas klien", () => {
    for (const f of walk("src").filter((x) => /\.(tsx?)$/.test(x))) {
      const text = readFileSync(f, "utf8");
      if (/^["']use client["']/m.test(text)) {
        expect(text).not.toMatch(/FREELLM_API_KEY|SUPABASE_SERVICE_ROLE_KEY/);
      }
    }
  });
});

describe("flags", () => {
  it("AI pre-review OFF secara default", () => {
    delete process.env.AI_PREREVIEW_ENABLED;
    expect(flags.aiPreReview).toBe(false);
    process.env.AI_PREREVIEW_ENABLED = "true";
    expect(flags.aiPreReview).toBe(true);
    delete process.env.AI_PREREVIEW_ENABLED;
  });
});

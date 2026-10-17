import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GatewayError, MIN_ATTEMPT_MS, chat } from "@/lib/ai/gateway";
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

describe("gateway: tenggat total per giliran (Task 24, A04)", () => {
  afterEach(() => vi.useRealTimers());
  const hang = (counter: { n: number }) => (async (_u: string, init: RequestInit) => {
    counter.n++;
    return new Promise((_r, rej) => init.signal!.addEventListener("abort", () => rej(new DOMException("x", "AbortError"))));
  }) as unknown as typeof fetch;

  it("sisa waktu kurang dari satu percobaan bermakna: tidak ada fetch, langsung TIMEOUT", async () => {
    const f = fakeFetch(ok());
    const t = 1_000_000;
    expect(await code(chat(msgs, { fetchImpl: f.impl, env, deadline: t + MIN_ATTEMPT_MS - 1, now: () => t }))).toBe("TIMEOUT");
    expect(f.bodies).toHaveLength(0);
  });

  it("5xx: ulang TIDAK dimulai bila sisa waktu tidak cukup", async () => {
    let t = 1_000_000;
    const slow500 = fakeFetch(async () => {
      t += 50_000; // percobaan pertama memakan 50 detik
      return new Response("", { status: 503 });
    });
    expect(await code(chat(msgs, { fetchImpl: slow500.impl, env, deadline: 1_000_000 + 60_000, now: () => t }))).toBe("UPSTREAM_5XX");
    expect(slow500.bodies).toHaveLength(1);
    // Sisa cukup: satu ulang tetap dilakukan (perilaku lama).
    t = 1_000_000;
    const quick500 = fakeFetch(new Response("", { status: 503 }));
    expect(await code(chat(msgs, { fetchImpl: quick500.impl, env, deadline: t + 75_000, now: () => t }))).toBe("UPSTREAM_5XX");
    expect(quick500.bodies).toHaveLength(2);
  });

  it("batas waktu percobaan dipotong ke sisa tenggat; timeout pertama yang menghabiskan tenggat tidak diulang", async () => {
    vi.useFakeTimers();
    const n = { n: 0 };
    const start = Date.now();
    const p = code(chat(msgs, { fetchImpl: hang(n), env, deadline: start + 30_000 }));
    await vi.advanceTimersByTimeAsync(29_999);
    expect(n.n).toBe(1);
    await vi.advanceTimersByTimeAsync(2);
    expect(await p).toBe("TIMEOUT");
    expect(n.n).toBe(1);
    expect(Date.now() - start).toBeLessThanOrEqual(30_001);
  });

  it("tanpa tenggat: perilaku lama (timeout 60 detik + satu ulang)", async () => {
    vi.useFakeTimers();
    const n = { n: 0 };
    const p = code(chat(msgs, { fetchImpl: hang(n), env }));
    await vi.advanceTimersByTimeAsync(60_001);
    expect(n.n).toBe(2);
    await vi.advanceTimersByTimeAsync(60_001);
    expect(await p).toBe("TIMEOUT");
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

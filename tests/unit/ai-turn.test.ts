import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { GatewayError, MIN_ATTEMPT_MS, type ChatOpts } from "@/lib/ai/gateway";
import { chatJsonWithinDeadline, TURN_DEADLINE_MS, turnDeadline } from "@/lib/ai/turn";

const schema = z.object({ reply: z.string() });
const msgs = [{ role: "user" as const, content: "halo" }];

describe("chatJsonWithinDeadline (Task 24, A04)", () => {
  it("tenggat total 75 detik; setiap panggilan (termasuk perbaikan) membawa tenggat yang sama", async () => {
    expect(TURN_DEADLINE_MS).toBe(75_000);
    expect(turnDeadline(() => 1000)).toBe(76_000);
    let calls = 0;
    const chat = vi.fn<(m: unknown, o?: ChatOpts) => Promise<{ text: string; requestId: string }>>(async () => ({ text: ++calls === 1 ? "rusak" : JSON.stringify({ reply: "ok" }), requestId: "r" }));
    const r = await chatJsonWithinDeadline(chat as never, schema, msgs, 123_456, () => 0);
    expect(r).toEqual({ ok: true, data: { reply: "ok" } });
    expect(chat.mock.calls.map((c) => c[1])).toEqual([{ deadline: 123_456 }, { deadline: 123_456 }]);
  });

  it("perbaikan JSON tidak dimulai bila sisa tenggat kurang dari satu percobaan bermakna → TIMEOUT", async () => {
    let t = 0;
    const deadline = turnDeadline(() => t);
    const chat = vi.fn(async () => {
      t += TURN_DEADLINE_MS - MIN_ATTEMPT_MS + 1; // percobaan pertama memakan hampir seluruh tenggat
      return { text: "bukan json", requestId: "r" };
    });
    const err = await chatJsonWithinDeadline(chat as never, schema, msgs, deadline, () => t).catch((e) => e);
    expect(err).toBeInstanceOf(GatewayError);
    expect((err as GatewayError).code).toBe("TIMEOUT");
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it("perbaikan yang timeout → TIMEOUT (bukan keluaran rusak); galat perbaikan lain tetap keluaran rusak", async () => {
    const timeoutRepair = vi.fn(async () => {
      if (timeoutRepair.mock.calls.length > 1) throw new GatewayError("TIMEOUT");
      return { text: "bukan json", requestId: "r" };
    });
    const err = await chatJsonWithinDeadline(timeoutRepair as never, schema, msgs, Date.now() + TURN_DEADLINE_MS).catch((e) => e);
    expect((err as GatewayError).code).toBe("TIMEOUT");

    const failingRepair = vi.fn(async () => {
      if (failingRepair.mock.calls.length > 1) throw new GatewayError("UPSTREAM_5XX");
      return { text: "bukan json", requestId: "r" };
    });
    expect(await chatJsonWithinDeadline(failingRepair as never, schema, msgs, Date.now() + TURN_DEADLINE_MS)).toEqual({ ok: false, fallback: "manual_form" });
  });

  it("keluaran rusak terus dengan tenggat cukup: tiga panggilan lalu keluaran rusak (perilaku lama)", async () => {
    const chat = vi.fn(async () => ({ text: "bukan json", requestId: "r" }));
    expect(await chatJsonWithinDeadline(chat as never, schema, msgs, Date.now() + TURN_DEADLINE_MS)).toEqual({ ok: false, fallback: "manual_form" });
    expect(chat).toHaveBeenCalledTimes(3);
  });
});

describe("maxDuration rute/aksi AI (Task 24, A04)", () => {
  it("setiap rute/halaman yang memanggil AI memberi waktu fungsi > tenggat giliran (dan ≤ 300 detik Vercel)", async () => {
    const { readFileSync } = await import("node:fs");
    for (const f of [
      "src/app/api/documents/[id]/chat/route.ts",
      "src/app/api/documents/versions/[versionId]/ai-review/route.ts",
      "src/app/(app)/documents/upload/page.tsx",
      "src/app/(app)/documents/[id]/page.tsx",
      "src/app/(app)/workspace/[id]/page.tsx",
      "src/app/(app)/workspace/pilih/page.tsx",
    ]) {
      const m = /^export const maxDuration = (\d+);$/m.exec(readFileSync(f, "utf8"));
      expect(m, f).not.toBeNull();
      const seconds = Number(m![1]);
      // Unggah: baca berkas (≤ 10 detik) + analisis AI (≤ 75 detik) dalam satu aksi.
      expect(seconds * 1000, f).toBeGreaterThan(TURN_DEADLINE_MS + 10_000);
      expect(seconds, f).toBeLessThanOrEqual(300);
    }
  });
});

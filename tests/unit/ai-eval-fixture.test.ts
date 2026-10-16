import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { groundSuggestions } from "@/lib/ai/grounding";
import { TEMPLATES } from "@/lib/documents/templates/registry";
import type { Category } from "@/lib/documents/types";

// Fixture evaluasi tanpa E2E (tests/fixtures/ai-eval-scenarios.json) untuk dipakai ulang oleh uji langsung berikutnya.
// Uji ini hanya menjaga fixture tetap konsisten dengan template dan aturan grounding; mutu model tidak dapat dibuktikan offline.
type Expect = string | number | { kw: string[] };
type Scenario = { id: string; category: Category | "CHOOSER"; type: string; turns: string[]; expect?: Record<string, Expect>; forbid?: string[]; expectReady?: boolean; expectChoice?: string; focus?: string[] };
const file = join(__dirname, "..", "fixtures", "ai-eval-scenarios.json");
const fixture = JSON.parse(readFileSync(file, "utf8")) as { scenarios: Scenario[] };

describe("fixture skenario evaluasi AI", () => {
  it("memuat semua skenario uji langsung, id unik, termasuk lima kegagalan recall dan kasus balasan", () => {
    const ids = fixture.scenarios.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ["N4", "N6", "N8", "U2", "P5", "U4", "U8", "N5", "U1", "N7", "P3"]) {
      expect(fixture.scenarios.find((s) => s.id === id)?.focus?.length, id).toBeGreaterThan(0);
    }
    expect(fixture.scenarios.length).toBeGreaterThanOrEqual(30);
  });

  it.each(fixture.scenarios.filter((s) => s.category !== "CHOOSER").map((s) => [s.id, s] as const))(
    "%s: kolom harapan dan larangan ada di template; nilai harapan tertulis di pesan pengguna (lolos grounding)",
    (_id, s) => {
      const t = TEMPLATES[s.category as Category];
      const keys = new Set(t.fields.map((f) => f.key));
      for (const k of [...Object.keys(s.expect ?? {}), ...(s.forbid ?? [])]) expect(keys.has(k), k).toBe(true);
      for (const k of Object.keys(s.expect ?? {})) expect(s.forbid ?? []).not.toContain(k);
      const story = s.turns.join("\n");
      const exact = Object.fromEntries(Object.entries(s.expect ?? {}).filter(([, v]) => typeof v !== "object"));
      // Harapan yang tidak lolos grounding berarti harapan itu sendiri mengarang nilai.
      expect(groundSuggestions(t, story, exact)).toEqual(exact);
      for (const [k, v] of Object.entries(s.expect ?? {})) {
        if (typeof v === "object") for (const kw of v.kw) expect(story.toLowerCase(), `${k}:${kw}`).toContain(kw.toLowerCase());
      }
      expect(typeof s.expectReady).toBe("boolean");
    },
  );

  it("skenario pemilih dokumen punya harapan pilihan", () => {
    for (const s of fixture.scenarios.filter((x) => x.category === "CHOOSER")) expect(s.expectChoice, s.id).toBeTruthy();
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { afterPublishPath } from "@/lib/reviews/paths";

describe("afterPublishPath", () => {
  it("setelah terbit, reviewer diarahkan ke dashboard mitra (penugasan sudah berakhir) bukan ke halaman editor", () => {
    expect(afterPublishPath("WITH_NOTES")).toBe("/partner?done=WITH_NOTES");
    expect(afterPublishPath("INCONCLUSIVE")).not.toContain("/partner/reviews");
  });
});

describe("editor mitra", () => {
  it("kolom isian dan pilihan memenuhi target sentuh min-h-12", () => {
    const src = readFileSync("src/app/(partner)/partner/reviews/[id]/page.tsx", "utf8");
    expect(src).toMatch(/const input = "[^"]*min-h-12/);
  });
});

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
    expect(readFileSync("src/components/ui/field.ts", "utf8")).toMatch(/export const fieldClass = "[^"]*min-h-12/);
    for (const p of ["src/app/(partner)/partner/reviews/[id]/page.tsx", "src/app/(partner)/partner/deep/[id]/page.tsx"]) {
      const src = readFileSync(p, "utf8");
      expect(src).toContain("fieldClass as input");
    }
  });
});

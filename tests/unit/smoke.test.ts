import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("project config", () => {
  it("strict mode on", () => {
    const cfg = JSON.parse(readFileSync("tsconfig.json", "utf8"));
    expect(cfg.compilerOptions.strict).toBe(true);
  });
});

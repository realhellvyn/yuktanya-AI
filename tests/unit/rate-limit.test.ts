import { describe, expect, it } from "vitest";
import { createRateLimiter } from "@/lib/vault/rate-limit";

describe("createRateLimiter", () => {
  it("menolak setelah batas, kembali bebas saat jendela bergeser, kunci independen", () => {
    let t = 0;
    const rl = createRateLimiter({ limit: 3, windowMs: 1000, now: () => t });
    expect([rl.allow("a"), rl.allow("a"), rl.allow("a"), rl.allow("a")]).toEqual([true, true, true, false]);
    expect(rl.allow("b")).toBe(true);
    t = 1001;
    expect(rl.allow("a")).toBe(true);
  });

  it("permintaan yang ditolak tidak memperpanjang hukuman", () => {
    let t = 0;
    const rl = createRateLimiter({ limit: 1, windowMs: 1000, now: () => t });
    expect(rl.allow("k")).toBe(true);
    t = 500;
    expect(rl.allow("k")).toBe(false);
    t = 1001;
    expect(rl.allow("k")).toBe(true);
  });
});

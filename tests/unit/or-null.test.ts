import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { orNull } from "@/lib/or-null";

describe("orNull (bawaan review Task 23)", () => {
  it("hasil diteruskan; galat → null dan log hanya nama kejadian + nama galat, tanpa pesan", async () => {
    const log = vi.fn();
    expect(await orNull(Promise.resolve(7), "x", log)).toBe(7);
    expect(log).not.toHaveBeenCalled();
    class PgError extends Error { name = "DatabaseError"; }
    expect(await orNull(Promise.reject(new PgError("relation ... user sinta@example.test")), "active_standard_review_lookup_failed", log)).toBeNull();
    expect(log).toHaveBeenCalledWith(JSON.stringify({ event: "active_standard_review_lookup_failed", error: "DatabaseError" }));
    expect(JSON.stringify(log.mock.calls)).not.toContain("sinta");
  });

  it("halaman dokumen membungkus lookup Legal Review aktif dengan orNull", () => {
    const page = readFileSync("src/app/(app)/documents/[id]/page.tsx", "utf8");
    expect(page).toMatch(/orNull\(billingService\(\)\.activeStandardReview\(userId, selected\.id\), "active_standard_review_lookup_failed"\)/);
  });
});

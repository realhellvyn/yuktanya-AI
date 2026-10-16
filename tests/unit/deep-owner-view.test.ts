import { describe, expect, it } from "vitest";
import { DEEP_PAYMENT_STATEMENT } from "@/lib/copy";
import { deepTimeline, enhancedExplanation } from "@/lib/deep/owner-view";

describe("deepTimeline", () => {
  const labels = (t: ReturnType<typeof deepTimeline>) => t.map((s) => `${s.label}:${s.state}`);
  it("lima tahap berurutan; setelah dibayar tapi belum ditugaskan", () => {
    expect(labels(deepTimeline({ status: "QUEUED", assigned: false }))).toEqual([
      "Dipesan:done", "Dibayar:done", "Ditugaskan:current", "Diperiksa:todo", "Selesai:todo"]);
  });
  it("ditugaskan, sedang diperiksa, selesai", () => {
    expect(labels(deepTimeline({ status: "QUEUED", assigned: true }))[2]).toBe("Ditugaskan:done");
    expect(labels(deepTimeline({ status: "QUEUED", assigned: true }))[3]).toBe("Diperiksa:current");
    expect(labels(deepTimeline({ status: "IN_REVIEW", assigned: true }))).toEqual(["Dipesan:done", "Dibayar:done", "Ditugaskan:done", "Diperiksa:current", "Selesai:todo"]);
    expect(labels(deepTimeline({ status: "COMPLETED", assigned: true })).every((l) => l.endsWith(":done"))).toBe(true);
  });
  it("ditahan atau dibatalkan tidak menandai selesai", () => {
    expect(labels(deepTimeline({ status: "ON_HOLD", assigned: true })).pop()).toBe("Selesai:todo");
    expect(labels(deepTimeline({ status: "CANCELLED", assigned: false })).pop()).toBe("Selesai:todo");
  });
});

describe("enhancedExplanation", () => {
  it("Enhanced hanya bila disetujui; lainnya memberi alasan sederhana tanpa janji", () => {
    expect(enhancedExplanation("ENHANCED_APPROVED", null).enhanced).toBe(true);
    for (const o of ["COMPLETED_WITH_NOTES", "INCONCLUSIVE", "REFERRED_SPECIAL_CASE", null]) {
      const e = enhancedExplanation(o, "Alasan reviewer");
      expect(e.enhanced).toBe(false);
      expect(e.text.length).toBeGreaterThan(20);
    }
    expect(enhancedExplanation("INCONCLUSIVE", null).text).toMatch(/belum dapat disimpulkan/i);
  });
  it("pernyataan pembayaran lengkap", () => {
    expect(DEEP_PAYMENT_STATEMENT).toMatch(/^Pembayaran tidak menjamin Enhanced/);
  });
});

import { describe, expect, it } from "vitest";
import { AI_REVIEW_STATUS_TEXT, aiReviewStatus } from "@/lib/ai/review-status";

describe("status analisis AI di halaman dokumen", () => {
  it("409 → 'khusus': diarahkan ke Kasus Hukum Khusus (Special Legal Case) dengan istilah glosarium; kuota tidak terpakai", () => {
    expect(aiReviewStatus(409)).toBe("khusus");
    expect(AI_REVIEW_STATUS_TEXT.khusus).toContain("Kasus Hukum Khusus (Special Legal Case)");
    expect(AI_REVIEW_STATUS_TEXT.khusus).toContain("tidak dianalisis AI");
    expect(AI_REVIEW_STATUS_TEXT.khusus).toContain("Kuota Anda tidak terpakai.");
    for (const t of Object.values(AI_REVIEW_STATUS_TEXT)) expect(t).not.toMatch(/Kasus Khusus/i);
  });

  it("504 → 'slow' (Task 24): AI lambat, kuota tidak terpakai; status lain tetap", () => {
    expect(aiReviewStatus(504)).toBe("slow");
    expect(AI_REVIEW_STATUS_TEXT.slow).toBe("AI sedang lambat. Analisis belum diproses dan kuota Anda tidak terpakai. Silakan coba lagi.");
    expect([aiReviewStatus(200), aiReviewStatus(429), aiReviewStatus(502), aiReviewStatus(500)]).toEqual(["ok", "quota", "down", "down"]);
  });
});

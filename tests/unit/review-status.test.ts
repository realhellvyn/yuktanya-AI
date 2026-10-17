import { describe, expect, it } from "vitest";
import { AI_REVIEW_STATUS_TEXT, aiReviewStatus, aiReviewStatusOf } from "@/lib/ai/review-status";

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

describe("Fix round 1 (M6): kode galat analisis AI dibedakan", () => {
  const res = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  it("AI_BUSY (sewa sedang dipakai) dan DUPLICATE_REQUEST → 'busy', TOO_MANY_ATTEMPTS → 'limit', kuota → 'quota'", async () => {
    expect(await aiReviewStatusOf(res(429, { code: "AI_BUSY" }))).toBe("busy");
    expect(await aiReviewStatusOf(res(409, { code: "DUPLICATE_REQUEST" }))).toBe("busy");
    expect(await aiReviewStatusOf(res(429, { code: "TOO_MANY_ATTEMPTS" }))).toBe("limit");
    expect(await aiReviewStatusOf(res(429, { code: "AI_REVIEW_QUOTA_REACHED" }))).toBe("quota");
    expect(await aiReviewStatusOf(res(429, { code: "AI_MESSAGE_QUOTA_REACHED" }))).toBe("quota");
    expect(await aiReviewStatusOf(res(409, { code: "SPECIAL_CASE_REQUIRED" }))).toBe("khusus");
    expect(await aiReviewStatusOf(res(504, { code: "AI_TIMEOUT" }))).toBe("slow");
    expect(await aiReviewStatusOf(res(200, { report: {} }))).toBe("ok");
    expect(await aiReviewStatusOf(new Response("bukan json", { status: 502 }))).toBe("down");
    expect(AI_REVIEW_STATUS_TEXT.busy).toBe("Review AI untuk dokumen ini sedang berjalan. Tunggu hingga selesai.");
    expect(AI_REVIEW_STATUS_TEXT.limit).toContain("Kuota Anda tidak terpakai");
  });
  it("kedua aksi (halaman dokumen dan unggah) memakai pemetaan berbasis kode", async () => {
    const { readFileSync } = await import("node:fs");
    for (const f of ["src/app/(app)/documents/ai-review-action.ts", "src/app/(app)/documents/upload/actions.ts"]) {
      const t = readFileSync(f, "utf8");
      expect(t, f).toContain("await aiReviewStatusOf(res)");
      expect(t, f).not.toMatch(/aiReviewStatus\(res\.status\)/);
    }
  });
});


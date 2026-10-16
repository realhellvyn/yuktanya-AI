import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PRICING, QUOTAS, formatIdr } from "@/lib/pricing/catalog";

const vectors = JSON.parse(readFileSync("tests/policy-vectors.json", "utf8"));
const pricing = (plan: string) => vectors.pricing.find((p: { plan: string }) => p.plan === plan);

describe("catalog", () => {
  it("formatIdr memakai titik ribuan", () => {
    expect(formatIdr(50000)).toBe("Rp50.000");
    expect(formatIdr(19000)).toBe("Rp19.000");
    expect(formatIdr(200000)).toBe("Rp200.000");
  });

  it("QUOTAS sama dengan policy-vectors", () => {
    const free = vectors.quotas.find((q: { plan: string }) => q.plan === "FREE");
    const member = vectors.quotas.find((q: { plan: string }) => q.plan === "MEMBER_ACTIVE");
    expect(QUOTAS.FREE).toEqual({ messages: free.messages, documents: free.documents, aiReviews: free.ai_reviews });
    expect(QUOTAS.MEMBER).toEqual({ messages: member.messages, documents: member.documents, aiReviews: member.ai_reviews });
  });

  it("harga standar dan Deep sama dengan policy-vectors", () => {
    expect(PRICING.membershipMonthlyIdr).toBe(19000);
    expect(PRICING.standard.free + PRICING.deepAdditional.free).toBe(pricing("FREE").service_total);
    expect(PRICING.standard.memberFirst + PRICING.deepAdditional.member).toBe(pricing("MEMBER_ACTIVE_FIRST").service_total);
    expect(PRICING.standard.memberLater + PRICING.deepAdditional.member).toBe(pricing("MEMBER_ACTIVE_LATER").service_total);
    expect(PRICING.standard).toEqual({ free: pricing("FREE").standard, memberFirst: pricing("MEMBER_ACTIVE_FIRST").standard, memberLater: pricing("MEMBER_ACTIVE_LATER").standard });
  });
});

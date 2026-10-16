import { beforeEach, describe, expect, it, vi } from "vitest";

const createOrder = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT:${to}`); } }));
vi.mock("@/lib/documents/session", () => ({ requireUserId: async () => "u1" }));
vi.mock("@/lib/billing/runtime", () => ({ billingService: () => ({ createOrder }) }));
vi.mock("@/lib/flags", () => ({ flags: { deepReviewPurchase: true } }));

import { requestDeepAction } from "@/app/(app)/checkout/actions";

const form = (v: string) => { const f = new FormData(); f.set("parentRequestId", v); return f; };
beforeEach(() => createOrder.mockReset());

describe("requestDeepAction", () => {
  it("parentRequestId bukan UUID: dialihkan dengan pemberitahuan, tidak pernah memanggil billing, tidak 500", async () => {
    for (const bad of ["bukan-uuid", "", "../x", "1' or 1=1"]) {
      await expect(requestDeepAction(form(bad))).rejects.toThrow(/^REDIRECT:\/reviews\?notice=deep-tidak-valid$/);
    }
    expect(createOrder).not.toHaveBeenCalled();
  });
  it("UUID valid tetap membuat order dan menuju checkout", async () => {
    createOrder.mockResolvedValue({ orderId: "o1" });
    await expect(requestDeepAction(form("00000000-0000-4000-8000-000000000000"))).rejects.toThrow("REDIRECT:/checkout/o1");
  });
});

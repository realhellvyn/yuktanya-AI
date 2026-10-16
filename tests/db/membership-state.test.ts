import { afterAll, describe, expect, it } from "vitest";
import { getMembershipState } from "@/lib/billing/membership";
import { createUser, getPool } from "./helpers";
import { makeKit, NOW } from "./phase3-helpers";

const pool = getPool();
afterAll(() => pool.end());
const kit = makeKit(pool);

describe("status membership untuk kartu dashboard", () => {
  it("tanpa membership aktif → active=false", async () => {
    const u = await createUser(pool);
    expect(await getMembershipState(pool, u, NOW)).toEqual({ active: false });
  });

  it("member aktif → tanggal periode dan diskon pertama belum terpakai", async () => {
    const u = await kit.member();
    const s = await getMembershipState(pool, u, NOW);
    expect(s.active).toBe(true);
    if (!s.active) return;
    expect(new Date(s.periodEnd).getTime()).toBeGreaterThan(NOW.getTime());
    expect(s.firstReviewUsed).toBe(false);
  });

  it("setelah order review pertama dibuat → firstReviewUsed=true", async () => {
    const u = await kit.member();
    const v = await kit.frozen(u);
    await kit.order(u, "STANDARD_REVIEW", v.versionId);
    const s = await getMembershipState(pool, u, NOW);
    expect(s.active && s.firstReviewUsed).toBe(true);
  });
});

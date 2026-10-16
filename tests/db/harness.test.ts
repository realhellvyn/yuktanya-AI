import { afterAll, describe, expect, it } from "vitest";
import { asAnon, asUser, createUser, getPool } from "./helpers";

const pool = getPool();
afterAll(() => pool.end());

describe("test DB harness", () => {
  it("auth.uid() mengikuti claims asUser", async () => {
    const userId = await createUser(pool);
    const uid = await asUser(pool, userId, async (c) => (await c.query("select auth.uid() as uid")).rows[0].uid);
    expect(uid).toBe(userId);
  });

  it("anon tidak punya uid", async () => {
    const uid = await asAnon(pool, async (c) => (await c.query("select auth.uid() as uid")).rows[0].uid);
    expect(uid).toBeNull();
  });
});

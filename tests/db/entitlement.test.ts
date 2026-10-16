import { afterAll, describe, expect, it } from "vitest";
import { QUOTAS } from "@/lib/pricing/catalog";
import { asUser, createUser, getPool } from "./helpers";

const pool = getPool();
afterAll(() => pool.end());

type Ent = { plan: string; messages: number; documents: number; ai_reviews: number; features: string[] };
const resolve = async (userId: string, now: string): Promise<Ent> =>
  (await pool.query("select * from resolve_entitlement($1, $2)", [userId, now])).rows[0];

const addMembership = (userId: string, status: string, start: string, end: string) =>
  pool.query("insert into memberships(user_id, status, period_start, period_end) values ($1, $2, $3, $4)", [userId, status, start, end]);

const NOW = "2026-10-16T05:00:00Z";

describe("resolve_entitlement", () => {
  it("tanpa membership → FREE 20/1/2", async () => {
    const u = await createUser(pool);
    expect(await resolve(u, NOW)).toMatchObject({ plan: "FREE", messages: 20, documents: 1, ai_reviews: 2 });
  });

  it("membership PENDING tidak memberi hak Member", async () => {
    const u = await createUser(pool);
    await addMembership(u, "PENDING", "2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z");
    expect((await resolve(u, NOW)).plan).toBe("FREE");
  });

  it("membership ACTIVE dalam periode → MEMBER 60/5/10", async () => {
    const u = await createUser(pool);
    await addMembership(u, "ACTIVE", "2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z");
    expect(await resolve(u, NOW)).toMatchObject({ plan: "MEMBER", messages: 60, documents: 5, ai_reviews: 10 });
  });

  it("EXPIRED, tepat di period_end, atau sebelum period_start → FREE", async () => {
    const expired = await createUser(pool);
    await addMembership(expired, "EXPIRED", "2026-09-01T00:00:00Z", "2026-10-01T00:00:00Z");
    expect((await resolve(expired, NOW)).plan).toBe("FREE");

    const atEnd = await createUser(pool);
    await addMembership(atEnd, "ACTIVE", "2026-09-16T05:00:00Z", NOW);
    expect((await resolve(atEnd, NOW)).plan).toBe("FREE");

    const future = await createUser(pool);
    await addMembership(future, "ACTIVE", "2026-10-17T00:00:00Z", "2026-11-17T00:00:00Z");
    expect((await resolve(future, NOW)).plan).toBe("FREE");
  });

  it("seed sama dengan QUOTAS di catalog.ts", async () => {
    const rows = (await pool.query("select product_key, grant_key, int_value from product_grants")).rows;
    const val = (product: string, grant: string) => rows.find((r) => r.product_key === product && r.grant_key === grant)?.int_value;
    for (const [plan, q] of Object.entries(QUOTAS)) {
      expect(val(`PLAN_${plan}`, "messages")).toBe(q.messages);
      expect(val(`PLAN_${plan}`, "documents")).toBe(q.documents);
      expect(val(`PLAN_${plan}`, "ai_reviews")).toBe(q.aiReviews);
    }
  });

  it("kunci fitur mengikuti pemetaan: usulan awal hanya untuk Member, dan baris tambahan ikut muncul", async () => {
    const u = await createUser(pool);
    await addMembership(u, "ACTIVE", "2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z");
    expect((await resolve(u, NOW)).features).toEqual(["vault.evidence_pack", "vault.reminders", "vault.share"]);
    await pool.query("insert into feature_plan_map(feature_key, plan) values ('x.sementara', 'MEMBER')");
    try {
      expect((await resolve(u, NOW)).features).toContain("x.sementara");
      const free = await createUser(pool);
      expect((await resolve(free, NOW)).features).toEqual([]);
    } finally {
      await pool.query("delete from feature_plan_map where feature_key = 'x.sementara'");
    }
  });
});

describe("akses klien ditutup", () => {
  it("authenticated tidak dapat menulis katalog/membership dan tidak dapat memanggil resolver", async () => {
    const u = await createUser(pool);
    for (const sql of [
      "insert into memberships(user_id, status, period_start, period_end) values (auth.uid(), 'ACTIVE', now(), now() + interval '30 days')",
      "insert into product_grants(product_key, grant_key, int_value) values ('PLAN_FREE', 'x', 1)",
      "insert into feature_plan_map(feature_key, plan) values ('vault.lain', 'FREE')",
      "select * from resolve_entitlement(auth.uid(), now())",
    ]) {
      await expect(asUser(pool, u, (c) => c.query(sql))).rejects.toMatchObject({ code: "42501" });
    }
  });
});

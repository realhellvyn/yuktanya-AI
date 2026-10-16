import { afterAll, describe, expect, it } from "vitest";
import { asUser, createUser, getPool } from "./helpers";

const pool = getPool();
afterAll(() => pool.end());
const NOW = "2026-10-16T05:00:00Z";
const has = async (u: string, f: string, now = NOW) => (await pool.query("select has_feature($1, $2, $3) as ok", [u, f, now])).rows[0].ok as boolean;
const member = async () => {
  const u = await createUser(pool);
  await pool.query("insert into memberships(user_id, status, period_start, period_end) values ($1, 'ACTIVE', '2026-10-01', '2026-11-01')", [u]);
  return u;
};
const VAULT = ["vault.evidence_pack", "vault.reminders", "vault.share"];

describe("has_feature dan pemetaan usulan", () => {
  it("Member memiliki tiga kunci usulan; Free tidak memiliki satu pun; kunci tak dikenal false", async () => {
    const m = await member();
    const f = await createUser(pool);
    for (const k of VAULT) {
      expect(await has(m, k)).toBe(true);
      expect(await has(f, k)).toBe(false);
    }
    expect(await has(m, "vault.nonexistent")).toBe(false);
    const ent = (await pool.query("select features from resolve_entitlement($1, $2)", [m, NOW])).rows[0].features;
    expect(ent).toEqual(VAULT);
  });

  it("keanggotaan kedaluwarsa kehilangan fitur", async () => {
    const u = await member();
    expect(await has(u, "vault.share", "2026-11-01T00:00:00Z")).toBe(false);
  });
});

describe("set_feature_plan", () => {
  it("hanya platform_admin; kunci dan plan divalidasi", async () => {
    const user = await createUser(pool);
    const admin = await createUser(pool, { roles: ["platform_admin"] });
    await expect(pool.query("select set_feature_plan($1, 'vault.share', 'FREE', true)", [user])).rejects.toThrow(/FORBIDDEN/);
    await expect(pool.query("select set_feature_plan($1, 'vault.lain', 'FREE', true)", [admin])).rejects.toThrow(/INVALID_FEATURE/);
    await expect(pool.query("select set_feature_plan($1, 'vault.share', 'GOLD', true)", [admin])).rejects.toThrow(/INVALID_PLAN/);
  });

  it("admin mengubah pemetaan, berlaku langsung, dan setiap perubahan diaudit", async () => {
    const admin = await createUser(pool, { roles: ["platform_admin"] });
    const free = await createUser(pool);
    const before = Number((await pool.query("select count(*) from audit_events where event_type = 'feature_map_changed' and actor_id = $1", [admin])).rows[0].count);
    try {
      await pool.query("select set_feature_plan($1, 'vault.share', 'FREE', true)", [admin]);
      expect(await has(free, "vault.share")).toBe(true);
    } finally {
      await pool.query("select set_feature_plan($1, 'vault.share', 'FREE', false)", [admin]);
    }
    expect(await has(free, "vault.share")).toBe(false);
    const after = Number((await pool.query("select count(*) from audit_events where event_type = 'feature_map_changed' and actor_id = $1", [admin])).rows[0].count);
    expect(after - before).toBe(2);
  });

  it("authenticated tidak dapat memanggil fungsi atau membaca outbox", async () => {
    const u = await createUser(pool);
    for (const sql of [
      "select has_feature(auth.uid(), 'vault.share')",
      "select set_feature_plan(auth.uid(), 'vault.share', 'FREE', true)",
      "select * from outbox_events",
      "select enqueue_outbox('k', '{}'::jsonb, 'd', now())",
    ]) {
      await expect(asUser(pool, u, (c) => c.query(sql))).rejects.toMatchObject({ code: "42501" });
    }
  });
});

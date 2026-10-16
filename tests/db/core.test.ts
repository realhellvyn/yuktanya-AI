import { afterAll, describe, expect, it } from "vitest";
import { asService, asUser, createUser, getPool } from "./helpers";

const pool = getPool();
afterAll(() => pool.end());

const rolesOf = async (id: string) =>
  (await pool.query("select role from user_roles where user_id = $1 order by role", [id])).rows.map((r) => r.role);

describe("core schema", () => {
  it("signup dengan meta role=platform_admin tetap hanya 'user'", async () => {
    const id = await createUser(pool, { meta: { role: "platform_admin", roles: ["platform_admin"] } });
    expect(await rolesOf(id)).toEqual(["user"]);
    const profile = await pool.query("select id from profiles where id = $1", [id]);
    expect(profile.rowCount).toBe(1);
  });

  it("user A tidak bisa membaca profil user B", async () => {
    const a = await createUser(pool);
    const b = await createUser(pool);
    const rows = await asUser(pool, a, async (c) => (await c.query("select id from profiles where id = $1", [b])).rows);
    expect(rows).toHaveLength(0);
    const own = await asUser(pool, a, async (c) => (await c.query("select id from profiles")).rows);
    expect(own.map((r) => r.id)).toEqual([a]);
  });

  it("user hanya dapat membaca role miliknya sendiri", async () => {
    const a = await createUser(pool);
    const b = await createUser(pool, { roles: ["reviewer"] });
    const rows = await asUser(pool, a, async (c) => (await c.query("select user_id, role from user_roles")).rows);
    expect(rows).toEqual([{ user_id: a, role: "user" }]);
    expect(rows.some((r) => r.user_id === b)).toBe(false);
  });

  it("user tidak bisa insert/update/delete user_roles, termasuk miliknya", async () => {
    const a = await createUser(pool);
    for (const sql of [
      "insert into user_roles(user_id, role) values (auth.uid(), 'platform_admin')",
      "update user_roles set role = 'platform_admin' where user_id = auth.uid()",
      "delete from user_roles where user_id = auth.uid()",
    ]) {
      await expect(asUser(pool, a, (c) => c.query(sql))).rejects.toMatchObject({ code: "42501" });
    }
    expect(await rolesOf(a)).toEqual(["user"]);
  });

  it("user tidak bisa mengubah kolom atribusi atau profil orang lain", async () => {
    const a = await createUser(pool);
    const b = await createUser(pool);
    await expect(asUser(pool, a, (c) => c.query("update profiles set utm_source = 'x' where id = auth.uid()"))).rejects.toMatchObject({ code: "42501" });
    const res = await asUser(pool, a, (c) => c.query("update profiles set display_name = 'hack' where id = $1", [b]));
    expect(res.rowCount).toBe(0);
    const mine = await asUser(pool, a, (c) => c.query("update profiles set display_name = 'Saya' where id = auth.uid()"));
    expect(mine.rowCount).toBe(1);
  });

  it("set_attribution menyimpan sentuhan pertama saja dan hanya untuk service_role", async () => {
    const a = await createUser(pool);
    await asService(pool, (c) => c.query("select set_attribution($1, 'meta', 'c1', 'v1')", [a]));
    await asService(pool, (c) => c.query("select set_attribution($1, 'google', 'c2', 'v2')", [a]));
    const row = (await pool.query("select utm_source, utm_campaign, utm_creative from profiles where id = $1", [a])).rows[0];
    expect(row).toEqual({ utm_source: "meta", utm_campaign: "c1", utm_creative: "v1" });
    await expect(asUser(pool, a, (c) => c.query("select set_attribution($1, 'x', 'x', 'x')", [a]))).rejects.toMatchObject({ code: "42501" });
  });

  it("audit_events tertutup untuk authenticated", async () => {
    const a = await createUser(pool);
    for (const sql of [
      "select * from audit_events",
      "insert into audit_events(event_type) values ('x')",
    ]) {
      await expect(asUser(pool, a, (c) => c.query(sql))).rejects.toMatchObject({ code: "42501" });
    }
  });

  it("audit_events append-only bahkan untuk service_role", async () => {
    await asService(pool, (c) => c.query("insert into audit_events(event_type, entity_id) values ('test.append', 'e1')"));
    await expect(asService(pool, (c) => c.query("update audit_events set event_type = 'x' where entity_id = 'e1'"))).rejects.toThrow(/append-only/);
    await expect(asService(pool, (c) => c.query("delete from audit_events where entity_id = 'e1'"))).rejects.toThrow(/append-only/);
  });

  it("product_events dedupe_key unik dan tertutup untuk authenticated", async () => {
    const key = `k-${Math.random()}`;
    await asService(pool, (c) => c.query("insert into product_events(event_name, dedupe_key) values ('signup_completed', $1)", [key]));
    await expect(asService(pool, (c) => c.query("insert into product_events(event_name, dedupe_key) values ('signup_completed', $1)", [key]))).rejects.toMatchObject({ code: "23505" });
    const a = await createUser(pool);
    await expect(asUser(pool, a, (c) => c.query("select * from product_events"))).rejects.toMatchObject({ code: "42501" });
  });
});

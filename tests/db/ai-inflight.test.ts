import { afterAll, describe, expect, it } from "vitest";
import { createPgInflight } from "@/lib/ai/inflight";
import { createUser, getPool } from "./helpers";

// Task 24 (A23): satu panggilan AI aktif per pengguna per jenis, lintas instance (ai_inflight_acquire/release, migrasi 41).
const pool = getPool();
afterAll(() => pool.end());

describe("sewa panggilan AI", () => {
  it("instance kedua tidak mendapat sewa selama yang pertama berjalan; setelah dilepas, sewa dapat diambil lagi", async () => {
    const u = await createUser(pool);
    const a = createPgInflight(pool, "chat");
    const b = createPgInflight(pool, "chat");
    const t1 = await a.acquire(u);
    expect(t1).toMatch(/^[0-9a-f-]{36}$/);
    expect(await b.acquire(u)).toBeNull();
    await a.release(u, t1!);
    const t2 = await b.acquire(u);
    expect(t2).not.toBeNull();
    expect(t2).not.toBe(t1);
  });

  it("jenis berbeda dan pengguna berbeda tidak saling mengunci", async () => {
    const u = await createUser(pool);
    const v = await createUser(pool);
    expect(await createPgInflight(pool, "chat").acquire(u)).not.toBeNull();
    expect(await createPgInflight(pool, "chooser").acquire(u)).not.toBeNull();
    expect(await createPgInflight(pool, "ai_review").acquire(u)).not.toBeNull();
    expect(await createPgInflight(pool, "chat").acquire(v)).not.toBeNull();
  });

  it("sewa kedaluwarsa (fungsi mati di tengah jalan) dapat diambil alih; pelepasan oleh pemegang lama tidak membebaskan pemegang baru", async () => {
    const u = await createUser(pool);
    const g = createPgInflight(pool, "chat", 120);
    const old = (await g.acquire(u))!;
    await pool.query("update ai_inflight_leases set expires_at = now() - interval '1 second' where user_id = $1 and scope = 'chat'", [u]);
    const fresh = (await g.acquire(u))!;
    expect(fresh).not.toBeNull();
    await g.release(u, old);
    expect(await g.acquire(u)).toBeNull();
    await g.release(u, fresh);
    expect(await g.acquire(u)).not.toBeNull();
  });

  it("serentak: tepat satu yang mendapat sewa", async () => {
    const u = await createUser(pool);
    const g = createPgInflight(pool, "ai_review");
    const rs = await Promise.all(Array.from({ length: 8 }, () => g.acquire(u)));
    expect(rs.filter(Boolean)).toHaveLength(1);
  });

  it("input buruk ditolak; tidak dapat dipanggil anon/authenticated", async () => {
    const u = await createUser(pool);
    await expect(pool.query("select ai_inflight_acquire($1, 'lain', gen_random_uuid(), 60)", [u])).rejects.toThrow(/BAD_REQUEST/);
    await expect(pool.query("select ai_inflight_acquire($1, 'chat', gen_random_uuid(), 0)", [u])).rejects.toThrow(/BAD_REQUEST/);
    await expect(pool.query("select ai_inflight_acquire($1, 'chat', gen_random_uuid(), 601)", [u])).rejects.toThrow(/BAD_REQUEST/);
    for (const role of ["anon", "authenticated"]) {
      expect((await pool.query("select has_function_privilege($1, 'public.ai_inflight_acquire(uuid,text,uuid,integer)', 'execute') as ok", [role])).rows[0].ok).toBe(false);
      expect((await pool.query("select has_function_privilege($1, 'public.ai_inflight_release(uuid,text,uuid)', 'execute') as ok", [role])).rows[0].ok).toBe(false);
      expect((await pool.query("select has_table_privilege($1, 'public.ai_inflight_leases', 'select') as ok", [role])).rows[0].ok).toBe(false);
    }
  });
});

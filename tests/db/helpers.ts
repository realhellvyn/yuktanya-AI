import { Pool, type PoolClient } from "pg";

let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    const url = process.env.TEST_DATABASE_URL;
    if (!url) throw new Error("TEST_DATABASE_URL belum diset; jalankan lewat `npm run test:db`.");
    pool = new Pool({ connectionString: url, max: 10 });
  }
  return pool;
}

export type AppRole = "user" | "reviewer" | "partner_admin" | "platform_admin";

export async function createUser(
  p: Pool,
  opts: { meta?: object; roles?: AppRole[] } = {},
): Promise<string> {
  const email = `u-${Math.random().toString(36).slice(2)}@example.test`;
  const { rows } = await p.query<{ id: string }>(
    "insert into auth.users(email, raw_user_meta_data) values ($1, $2) returning id",
    [email, JSON.stringify(opts.meta ?? {})],
  );
  for (const role of opts.roles ?? []) {
    await p.query("insert into user_roles(user_id, role) values ($1, $2) on conflict do nothing", [rows[0].id, role]);
  }
  return rows[0].id;
}

async function asRole<T>(
  p: Pool,
  role: "anon" | "authenticated" | "service_role",
  userId: string | null,
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> {
  const c = await p.connect();
  try {
    await c.query("begin");
    await c.query(`set local role ${role}`);
    const claims = userId ? { sub: userId, role } : { role };
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    const result = await fn(c);
    await c.query("commit");
    return result;
  } catch (err) {
    await c.query("rollback");
    throw err;
  } finally {
    c.release();
  }
}

export const asUser = <T>(p: Pool, userId: string, fn: (c: PoolClient) => Promise<T>) =>
  asRole(p, "authenticated", userId, fn);
export const asAnon = <T>(p: Pool, fn: (c: PoolClient) => Promise<T>) => asRole(p, "anon", null, fn);
export const asService = <T>(p: Pool, fn: (c: PoolClient) => Promise<T>) =>
  asRole(p, "service_role", null, fn);

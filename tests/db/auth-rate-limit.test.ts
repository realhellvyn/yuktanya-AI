import { afterAll, describe, expect, it } from "vitest";
import { createPgAuthLimiter, type AuthLimits } from "@/lib/auth/rate-limit";
import { getPool } from "./helpers";

// Audit C12: pembatas percobaan auth berbasis Postgres (lintas instance), tanpa email/IP mentah tersimpan.
const pool = getPool();
afterAll(() => pool.end());
const NOW = new Date("2026-10-16T05:00:00Z");
const t = (s: number) => new Date(NOW.getTime() + s * 1000);
const uniq = () => Math.random().toString(36).slice(2);
const LIMITS: AuthLimits = {
  login: [{ dim: "ip_email", limit: 3, windowSeconds: 900 }, { dim: "ip", limit: 5, windowSeconds: 900 }],
  signup: [{ dim: "ip_email", limit: 2, windowSeconds: 3600 }, { dim: "email", limit: 3, windowSeconds: 3600 }],
  reset: [{ dim: "ip_email", limit: 2, windowSeconds: 3600 }, { dim: "email", limit: 3, windowSeconds: 3600 }],
  resend: [{ dim: "ip_email", limit: 2, windowSeconds: 3600 }],
};

describe("auth_attempt_allowed", () => {
  it("menolak setelah batas IP+email, pulih setelah jendela, dan dimensi IP membatasi banyak email dari satu IP", async () => {
    const lim = createPgAuthLimiter(pool, LIMITS);
    const ip = `ip-${uniq()}`;
    const a = `a-${uniq()}@example.test`;
    expect([await lim.allow("login", ip, a, NOW), await lim.allow("login", ip, a, NOW), await lim.allow("login", ip, a, NOW), await lim.allow("login", ip, a, NOW)])
      .toEqual([true, true, true, false]);
    expect(await lim.allow("login", `ip-${uniq()}`, a, NOW)).toBe(true); // IP lain untuk email yang sama
    expect(await lim.allow("login", ip, `b-${uniq()}@example.test`, NOW)).toBe(true); // percobaan ke-4 di IP ini
    expect(await lim.allow("login", ip, `c-${uniq()}@example.test`, NOW)).toBe(true); // ke-5
    expect(await lim.allow("login", ip, `d-${uniq()}@example.test`, NOW)).toBe(false); // batas IP 5
    expect(await lim.allow("login", ip, a, t(901))).toBe(true);
  });

  it("batas per email untuk aksi pengirim email berlaku walau IP berganti; aksi terpisah", async () => {
    const lim = createPgAuthLimiter(pool, LIMITS);
    const e = `r-${uniq()}@example.test`;
    const rs = [];
    for (let i = 0; i < 4; i++) rs.push(await lim.allow("reset", `ip-${uniq()}`, e, NOW));
    expect(rs).toEqual([true, true, true, false]);
    expect(await lim.allow("signup", `ip-${uniq()}`, e, NOW)).toBe(true);
  });

  it("serentak: tidak melampaui batas", async () => {
    const lim = createPgAuthLimiter(pool, LIMITS);
    const ip = `ip-${uniq()}`;
    const e = `s-${uniq()}@example.test`;
    const rs = await Promise.all(Array.from({ length: 8 }, () => lim.allow("login", ip, e, NOW)));
    expect(rs.filter(Boolean)).toHaveLength(3);
  });

  it("tidak menyimpan email atau IP mentah; input buruk ditolak; tidak dapat dipanggil anon/authenticated", async () => {
    const lim = createPgAuthLimiter(pool, LIMITS);
    const e = `raw-${uniq()}@example.test`;
    await lim.allow("signup", "203.0.113.99", e, NOW);
    const dump = JSON.stringify((await pool.query("select * from auth_attempts")).rows);
    expect(dump).not.toContain(e);
    expect(dump).not.toContain("203.0.113.99");
    await expect(pool.query("select auth_attempt_allowed('login:ip', 'bukan-hash', 3, 60, $1)", [NOW])).rejects.toThrow(/BAD_REQUEST/);
    await expect(pool.query("select auth_attempt_allowed('lain:ip', $1, 3, 60, $2)", ["a".repeat(64), NOW])).rejects.toThrow(/BAD_REQUEST/);
    for (const role of ["anon", "authenticated"]) {
      expect((await pool.query("select has_function_privilege($1, 'public.auth_attempt_allowed(text,text,integer,integer,timestamptz)', 'execute') as ok", [role])).rows[0].ok).toBe(false);
      expect((await pool.query("select has_table_privilege($1, 'public.auth_attempts', 'select') as ok", [role])).rows[0].ok).toBe(false);
    }
  });
});

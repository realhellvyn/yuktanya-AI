import { afterAll, describe, expect, it, vi } from "vitest";
import { createPgRateLimiter, RATE_RULES, rateLimitKey, type RateRule } from "@/lib/security/rate-limit";
import { getPool } from "./helpers";

// Task 24 (A07): pembatas laju umum lintas instance (rate_limit_allowed, migrasi 41). Jam dari database.
const pool = getPool();
afterAll(() => pool.end());
const uniq = () => Math.random().toString(36).slice(2);
const rule = (limit: number, windowSeconds = 60): RateRule => ({ limit, windowSeconds, onDbError: "open" });
const age = (scope: string, key: string, seconds: number) =>
  pool.query("update rate_limit_hits set window_start = window_start - make_interval(secs => $3) where scope = $1 and key_hash = $2", [scope, rateLimitKey(scope as never, key), seconds]);

describe("rate_limit_allowed", () => {
  it("batas per kunci: ke-(limit+1) ditolak; dua instance (dua pembatas) berbagi hitungan yang sama", async () => {
    const ip = `198.51.100.${uniq()}`;
    const a = createPgRateLimiter(pool, "verify_page", rule(3));
    const b = createPgRateLimiter(pool, "verify_page", rule(3));
    expect([await a.allow(ip), await b.allow(ip), await a.allow(ip), await b.allow(ip), await a.allow(ip)]).toEqual([true, true, true, false, false]);
  });

  it("jendela dengan jam database: pulih setelah jendela lewat; penolakan tidak memperpanjang jendela", async () => {
    const ip = `ip-${uniq()}`;
    const l = createPgRateLimiter(pool, "share_page", rule(2, 60));
    expect([await l.allow(ip), await l.allow(ip), await l.allow(ip), await l.allow(ip)]).toEqual([true, true, false, false]);
    await age("share_page", ip, 59);
    expect(await l.allow(ip)).toBe(false);
    await age("share_page", ip, 2);
    expect(await l.allow(ip)).toBe(true);
    const row = (await pool.query("select hits, now() - window_start < interval '5 seconds' as fresh from rate_limit_hits where scope = 'share_page' and key_hash = $1", [rateLimitKey("share_page", ip)])).rows[0];
    expect(row).toEqual({ hits: 1, fresh: true });
    // Hitungan dibatasi di limit + 1 walau ditolak berkali-kali.
    for (let i = 0; i < 5; i++) await l.allow(ip);
    expect((await pool.query("select hits from rate_limit_hits where scope = 'share_page' and key_hash = $1", [rateLimitKey("share_page", ip)])).rows[0].hits).toBe(3);
  });

  it("kunci berbeda (IP, token, pengguna) dan cakupan berbeda tidak saling memengaruhi", async () => {
    const l = createPgRateLimiter(pool, "account_export", rule(1, 3600));
    const u1 = `user-${uniq()}`, u2 = `user-${uniq()}`;
    expect([await l.allow(u1), await l.allow(u1), await l.allow(u2)]).toEqual([true, false, true]);
    const other = createPgRateLimiter(pool, "payment_refresh", rule(1));
    expect(await other.allow(u1)).toBe(true);
    const ack = createPgRateLimiter(pool, "share_ack", rule(1));
    const t1 = `token-${uniq()}`;
    expect([await ack.allow(t1), await ack.allow(`token-${uniq()}`), await ack.allow(t1)]).toEqual([true, true, false]);
  });

  it("serentak: tidak melampaui batas", async () => {
    const l = createPgRateLimiter(pool, "midtrans_webhook", rule(4));
    const ip = `ip-${uniq()}`;
    const rs = await Promise.all(Array.from({ length: 12 }, () => l.allow(ip)));
    expect(rs.filter(Boolean)).toHaveLength(4);
  });

  it("tidak menyimpan kunci mentah; input buruk ditolak; tidak dapat dipanggil anon/authenticated", async () => {
    const ip = "203.0.113.77";
    await createPgRateLimiter(pool, "verify_page").allow(ip);
    expect(JSON.stringify((await pool.query("select * from rate_limit_hits")).rows)).not.toContain(ip);
    const h = "a".repeat(64);
    await expect(pool.query("select rate_limit_allowed('lain', $1, 3, 60)", [h])).rejects.toThrow(/BAD_REQUEST/);
    await expect(pool.query("select rate_limit_allowed('verify_page', 'bukan-hash', 3, 60)")).rejects.toThrow(/BAD_REQUEST/);
    await expect(pool.query("select rate_limit_allowed('verify_page', $1, 0, 60)", [h])).rejects.toThrow(/BAD_REQUEST/);
    await expect(pool.query("select rate_limit_allowed('verify_page', $1, 3, 0)", [h])).rejects.toThrow(/BAD_REQUEST/);
    for (const role of ["anon", "authenticated"]) {
      expect((await pool.query("select has_function_privilege($1, 'public.rate_limit_allowed(text,text,integer,integer)', 'execute') as ok", [role])).rows[0].ok).toBe(false);
      expect((await pool.query("select has_table_privilege($1, 'public.rate_limit_hits', 'select') as ok", [role])).rows[0].ok).toBe(false);
    }
    expect((await pool.query("select has_function_privilege('service_role', 'public.rate_limit_allowed(text,text,integer,integer)', 'execute') as ok")).rows[0].ok).toBe(true);
  });

  it("DB gagal (fungsi tidak dapat dipanggil): fail-open/closed sesuai kebijakan cakupan", async () => {
    const log = vi.fn();
    const broken = { query: (sql: string, args?: unknown[]) => pool.query(sql.replace("rate_limit_allowed", "rate_limit_tidak_ada"), args) };
    expect(await createPgRateLimiter(broken, "midtrans_webhook", RATE_RULES.midtrans_webhook, log).allow("x")).toBe(true);
    expect(await createPgRateLimiter(broken, "share_ack", RATE_RULES.share_ack, log).allow("x")).toBe(false);
    expect(log).toHaveBeenCalledTimes(2);
  });
});

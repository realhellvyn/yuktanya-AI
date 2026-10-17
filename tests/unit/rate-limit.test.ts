import { describe, expect, it, vi } from "vitest";
import { createPgRateLimiter, RATE_LIMIT_TIMEOUT_MS, RATE_RULES, rateLimitKey } from "@/lib/security/rate-limit";

// Task 24 (A07): pembatas laju umum berbasis DB. Uji DB (batas, jendela, kunci, serentak): tests/db/rate-limit.test.ts.
describe("createPgRateLimiter", () => {
  it("batas angka sama dengan pembatas memori sebelumnya; kebijakan gagal DB per rute", () => {
    expect(RATE_RULES).toEqual({
      verify_page: { limit: 30, windowSeconds: 60, onDbError: "open" },
      share_page: { limit: 30, windowSeconds: 60, onDbError: "open" },
      share_ack: { limit: 10, windowSeconds: 60, onDbError: "closed" },
      account_export: { limit: 5, windowSeconds: 3600, onDbError: "closed" },
      midtrans_webhook: { limit: 120, windowSeconds: 60, onDbError: "open" },
      payment_refresh: { limit: 6, windowSeconds: 60, onDbError: "open" },
    });
  });

  it("memanggil rate_limit_allowed dengan hash kunci (bukan kunci mentah) dan batas cakupan", async () => {
    const query = vi.fn(async () => ({ rows: [{ ok: true }] }));
    expect(await createPgRateLimiter({ query }, "verify_page").allow("203.0.113.5")).toBe(true);
    expect(query).toHaveBeenCalledWith("select rate_limit_allowed($1, $2, $3, $4) as ok", ["verify_page", rateLimitKey("verify_page", "203.0.113.5"), 30, 60]);
    expect(JSON.stringify(query.mock.calls)).not.toContain("203.0.113.5");
    expect(rateLimitKey("verify_page", "x")).toMatch(/^[0-9a-f]{64}$/);
    expect(rateLimitKey("verify_page", "x")).not.toBe(rateLimitKey("share_page", "x"));
    const denied = vi.fn(async () => ({ rows: [{ ok: false }] }));
    expect(await createPgRateLimiter({ query: denied }, "share_ack").allow("k")).toBe(false);
  });

  it("Fix round 1 (M5): kueri pembatas yang menggantung dipotong 2 detik lalu memakai kebijakan cakupan", async () => {
    vi.useFakeTimers();
    try {
      const hang = { query: vi.fn(() => new Promise<never>(() => {})) };
      const log = vi.fn();
      const open = createPgRateLimiter(hang, "midtrans_webhook", RATE_RULES.midtrans_webhook, log).allow("k");
      const closed = createPgRateLimiter(hang, "account_export", RATE_RULES.account_export, log).allow("k");
      await vi.advanceTimersByTimeAsync(1_999);
      expect(log).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(2);
      expect([await open, await closed]).toEqual([true, false]);
      expect(log).toHaveBeenCalledWith({ event: "rate_limit_unavailable", scope: "midtrans_webhook", policy: "open", error: "TIMEOUT" });
      expect(RATE_LIMIT_TIMEOUT_MS).toBe(2_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("DB gagal: fail-open untuk halaman publik/webhook/perbarui status, fail-closed untuk konfirmasi baca/ekspor; log tanpa kunci", async () => {
    const broken = { query: vi.fn(async () => { throw new Error("koneksi putus 203.0.113.9"); }) };
    const log = vi.fn();
    const verdicts = Object.fromEntries(await Promise.all((Object.keys(RATE_RULES) as (keyof typeof RATE_RULES)[]).map(async (s) => [s, await createPgRateLimiter(broken, s, RATE_RULES[s], log).allow("203.0.113.9")])));
    expect(verdicts).toEqual({ verify_page: true, share_page: true, share_ack: false, account_export: false, midtrans_webhook: true, payment_refresh: true });
    expect(log).toHaveBeenCalledWith({ event: "rate_limit_unavailable", scope: "midtrans_webhook", policy: "open", error: "Error" });
    expect(JSON.stringify(log.mock.calls)).not.toContain("203.0.113.9");
  });
});

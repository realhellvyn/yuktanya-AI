import { beforeEach, describe, expect, it, vi } from "vitest";

// Audit C12: pembatas laju di aplikasi untuk masuk, daftar, minta atur ulang kata sandi, dan kirim ulang konfirmasi.
const auth = {
  signInWithPassword: vi.fn(async () => ({ error: null })),
  signUp: vi.fn(async () => ({ data: { user: null, session: null }, error: null })),
  resetPasswordForEmail: vi.fn(async () => ({ error: null })),
  resend: vi.fn(async () => ({ error: null })),
};
const limiter = { allow: vi.fn(async () => true) };
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT:${to}`); } }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1, 10.0.0.1" }),
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth }) }));
vi.mock("@/lib/supabase/roles", () => ({ hasSupabaseEnv: () => true }));
vi.mock("@/lib/auth/limiter-runtime", () => ({ authLimiter: () => limiter }));
vi.mock("@/lib/db", () => ({ getPool: () => ({}) }));
vi.mock("@/lib/analytics/events", () => ({ trackEvent: async () => true }));
vi.mock("@/lib/auth/record-attribution", () => ({ recordAttribution: async () => undefined }));

import { requestPasswordReset, resendConfirmation, signIn, signUp } from "@/app/(auth)/actions";
import { authLimitKey, clientIp, DEFAULT_AUTH_LIMITS } from "@/lib/auth/rate-limit";
import { AUTH_MESSAGES } from "@/lib/auth/messages";

const form = (v: Record<string, string>) => { const f = new FormData(); for (const [k, x] of Object.entries(v)) f.set(k, x); return f; };
const cred = { email: "Budi@Example.test", password: "rahasia-123", returnTo: "/dashboard" };
const supabaseCalls = () => Object.values(auth).reduce((n, f) => n + f.mock.calls.length, 0);
beforeEach(() => { for (const f of Object.values(auth)) f.mockClear(); limiter.allow.mockReset(); limiter.allow.mockResolvedValue(true); });

describe("aksi auth dengan pembatas laju", () => {
  it("melewati batas: semua aksi dijawab pesan biasa tanpa memanggil Supabase", async () => {
    limiter.allow.mockResolvedValue(false);
    await expect(signIn(form(cred))).rejects.toThrow("REDIRECT:/login?error=rate_limited&returnTo=%2Fdashboard");
    await expect(signUp(form(cred))).rejects.toThrow("REDIRECT:/register?error=rate_limited&returnTo=%2Fdashboard");
    await expect(requestPasswordReset(form({ email: cred.email }))).rejects.toThrow("REDIRECT:/forgot-password?error=rate_limited");
    await expect(resendConfirmation(form({ email: cred.email, page: "register", returnTo: "/dashboard" }))).rejects.toThrow("REDIRECT:/register?error=rate_limited&returnTo=%2Fdashboard");
    expect(supabaseCalls()).toBe(0);
    expect(AUTH_MESSAGES.rate_limited).toBe("Terlalu banyak percobaan. Tunggu beberapa menit, lalu coba lagi.");
  });

  it("kunci memakai IP klien dan email yang dinormalkan, sebelum keberadaan akun diperiksa", async () => {
    await expect(signIn(form(cred))).rejects.toThrow("REDIRECT:/dashboard");
    expect(limiter.allow).toHaveBeenCalledWith("login", "203.0.113.7", "budi@example.test");
    await expect(requestPasswordReset(form({ email: cred.email }))).rejects.toThrow("REDIRECT:/forgot-password?sent=1");
    expect(limiter.allow).toHaveBeenLastCalledWith("reset", "203.0.113.7", "budi@example.test");
    await expect(signUp(form(cred))).rejects.toThrow(/REDIRECT:/);
    expect(limiter.allow).toHaveBeenLastCalledWith("signup", "203.0.113.7", "budi@example.test");
    await expect(resendConfirmation(form({ email: cred.email }))).rejects.toThrow(/REDIRECT:/);
    expect(limiter.allow).toHaveBeenLastCalledWith("resend", "203.0.113.7", "budi@example.test");
  });

  it("isian tidak valid tidak menghitung percobaan", async () => {
    await expect(signIn(form({ email: "bukan-email", password: "x" }))).rejects.toThrow(/error=invalid/);
    expect(limiter.allow).not.toHaveBeenCalled();
  });

  it("pembatas tidak dapat dihubungi: tidak memblokir masuk (batas Supabase Auth tetap berlaku)", async () => {
    limiter.allow.mockRejectedValue(new Error("db down"));
    await expect(signIn(form(cred))).rejects.toThrow("REDIRECT:/dashboard");
    expect(auth.signInWithPassword).toHaveBeenCalledTimes(1);
  });
});

describe("kunci dan batas", () => {
  it("kunci adalah hash SHA-256 (tanpa email/IP mentah) dan berbeda per dimensi", () => {
    const k = ["ip_email", "ip", "email"].map((d) => authLimitKey(d as "ip", "203.0.113.7", "budi@example.test"));
    for (const x of k) expect(x).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set(k).size).toBe(3);
    expect(authLimitKey("ip", "203.0.113.7", "a@b.co")).toBe(authLimitKey("ip", "203.0.113.7", "c@d.co"));
    expect(authLimitKey("email", "1.1.1.1", "a@b.co")).toBe(authLimitKey("email", "2.2.2.2", "a@b.co"));
  });

  it("setiap aksi memakai dimensi IP+email; aksi pengirim email juga dibatasi per email", () => {
    for (const a of ["login", "signup", "reset", "resend"] as const) expect(DEFAULT_AUTH_LIMITS[a].map((r) => r.dim)).toContain("ip_email");
    for (const a of ["signup", "reset", "resend"] as const) expect(DEFAULT_AUTH_LIMITS[a].map((r) => r.dim)).toContain("email");
  });

  it("IP klien: x-real-ip, lalu nilai pertama x-forwarded-for, lalu 'unknown'", () => {
    expect(clientIp(new Headers({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "1.1.1.1" }))).toBe("203.0.113.7");
    expect(clientIp(new Headers({ "x-forwarded-for": "198.51.100.1, 10.0.0.1" }))).toBe("198.51.100.1");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});

import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import { appOrigin, AppUrlError } from "@/lib/app-url";
import { attributionCookieOptions } from "@/lib/auth/attribution";
import { buildCsp, cspNonce, staticSecurityHeaders } from "@/lib/security/headers";
import { supabaseCookieOptions } from "@/lib/supabase/cookie-options";
import { verifyUrl } from "@/lib/verification/qr";

const CODE = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4";
const directives = (csp: string) => Object.fromEntries(csp.split(";").map((d) => d.trim()).filter(Boolean).map((d) => { const [k, ...v] = d.split(/\s+/); return [k, v]; }));

describe("Content-Security-Policy (audit C22)", () => {
  const prod = directives(buildCsp({ nonce: "abc123", production: true, supabaseUrl: "https://proj.supabase.co" }));
  const dev = directives(buildCsp({ nonce: "abc123", production: false, supabaseUrl: "http://127.0.0.1:54999" }));

  it("produksi: skrip hanya dengan nonce (tanpa unsafe-inline/unsafe-eval), framing dilarang, basis dan form ke situs sendiri", () => {
    expect(prod["script-src"]).toEqual(["'self'", "'nonce-abc123'", "'strict-dynamic'"]);
    expect(prod["frame-ancestors"]).toEqual(["'none'"]);
    expect(prod["default-src"]).toEqual(["'self'"]);
    expect(prod["object-src"]).toEqual(["'none'"]);
    expect(prod["base-uri"]).toEqual(["'self'"]);
    expect(prod["form-action"]).toEqual(["'self'"]);
    expect(prod["connect-src"]).toEqual(["'self'", "https://proj.supabase.co"]);
    expect(prod["upgrade-insecure-requests"]).toEqual([]);
    expect(Object.values(prod).flat()).not.toContain("'unsafe-eval'");
  });

  it("'unsafe-inline' hanya untuk gaya (atribut style React), tidak pernah untuk skrip", () => {
    expect(prod["style-src"]).toEqual(["'self'", "'unsafe-inline'"]);
    for (const [k, v] of Object.entries(prod)) if (k !== "style-src") expect(v).not.toContain("'unsafe-inline'");
  });

  it("pengembangan (next dev): 'unsafe-eval' dan websocket HMR diizinkan; tanpa upgrade-insecure-requests", () => {
    expect(dev["script-src"]).toContain("'unsafe-eval'");
    expect(dev["connect-src"]).toEqual(expect.arrayContaining(["'self'", "ws:"]));
    expect(dev["upgrade-insecure-requests"]).toBeUndefined();
    expect(dev["frame-ancestors"]).toEqual(["'none'"]);
  });

  it("login Google (bila aktif) menambah tujuan form OAuth; asal Supabase hanya origin", () => {
    const g = directives(buildCsp({ nonce: "n", production: true, supabaseUrl: "https://proj.supabase.co/rest/v1?x=1", googleAuth: true }));
    expect(g["form-action"]).toEqual(["'self'", "https://proj.supabase.co", "https://accounts.google.com"]);
    expect(g["connect-src"]).toEqual(["'self'", "https://proj.supabase.co"]);
  });

  it("Midtrans aktif (Task 21): form-action hanya menambah dua asal halaman bayar Midtrans; script-src/connect-src tidak berubah", () => {
    const m = directives(buildCsp({ nonce: "abc123", production: true, supabaseUrl: "https://proj.supabase.co", midtrans: true }));
    expect(m["form-action"]).toEqual(["'self'", "https://app.midtrans.com", "https://app.sandbox.midtrans.com"]);
    expect(m["script-src"]).toEqual(prod["script-src"]);
    expect(m["connect-src"]).toEqual(prod["connect-src"]);
    expect(m["frame-ancestors"]).toEqual(["'none'"]);
    const both = directives(buildCsp({ nonce: "n", production: true, supabaseUrl: "https://proj.supabase.co", googleAuth: true, midtrans: true }));
    expect(both["form-action"]).toEqual(["'self'", "https://proj.supabase.co", "https://accounts.google.com", "https://app.midtrans.com", "https://app.sandbox.midtrans.com"]);
  });

  it("nonce acak per permintaan (base64, ≥ 128 bit)", () => {
    const a = cspNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22,}={0,2}$/);
    expect(cspNonce()).not.toBe(a);
  });
});

describe("header keamanan statis", () => {
  const map = (prod: boolean) => Object.fromEntries(staticSecurityHeaders({ production: prod }).map((h) => [h.key, h.value]));
  it("produksi: XFO DENY, nosniff, referrer ketat, Permissions-Policy menolak kamera/mikrofon/lokasi, HSTS", () => {
    const h = map(true);
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["Permissions-Policy"]).toMatch(/camera=\(\)/);
    expect(h["Permissions-Policy"]).toMatch(/microphone=\(\)/);
    expect(h["Permissions-Policy"]).toMatch(/geolocation=\(\)/);
    expect(h["Strict-Transport-Security"]).toBe("max-age=63072000; includeSubDomains");
  });
  it("pengembangan: tanpa HSTS (localhost http)", () => {
    expect(map(false)["Strict-Transport-Security"]).toBeUndefined();
    expect(map(false)["X-Frame-Options"]).toBe("DENY");
  });
  it("next.config memasang header itu untuk semua jalur", async () => {
    const rules = await nextConfig.headers!();
    const all = rules.find((r) => r.source === "/:path*");
    expect(all?.headers.map((h) => h.key)).toEqual(expect.arrayContaining(["X-Frame-Options", "X-Content-Type-Options", "Referrer-Policy", "Permissions-Policy"]));
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});

describe("NEXT_PUBLIC_APP_URL gagal tertutup di produksi (audit C34)", () => {
  it.each([undefined, "", "http://yuktanya.id", "bukan url", "ftp://x.id"])("produksi menolak %j", (v) => {
    expect(() => appOrigin({ NODE_ENV: "production", NEXT_PUBLIC_APP_URL: v })).toThrow(AppUrlError);
  });
  it("produksi https → origin tanpa garis miring/path", () => {
    expect(appOrigin({ NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "https://yuktanya.id/" })).toBe("https://yuktanya.id");
  });
  it("pengembangan/tes tetap jalan: fallback localhost, http lokal diterima", () => {
    expect(appOrigin({ NODE_ENV: "development" })).toBe("http://localhost:3000");
    expect(appOrigin({ NODE_ENV: "test", NEXT_PUBLIC_APP_URL: "http://localhost:3100" })).toBe("http://localhost:3100");
  });
  it("QR/verifikasi memakai basis yang sama (produksi tanpa URL → gagal, bukan URL palsu)", () => {
    const env = process.env as Record<string, string | undefined>;
    const saved = { NODE_ENV: env.NODE_ENV, URL: env.NEXT_PUBLIC_APP_URL };
    try {
      env.NODE_ENV = "production";
      delete env.NEXT_PUBLIC_APP_URL;
      expect(() => verifyUrl(CODE)).toThrow(AppUrlError);
      env.NEXT_PUBLIC_APP_URL = "https://yuktanya.id";
      expect(verifyUrl(CODE)).toBe(`https://yuktanya.id/verify/${CODE}`);
    } finally {
      env.NODE_ENV = saved.NODE_ENV;
      if (saved.URL === undefined) delete env.NEXT_PUBLIC_APP_URL; else env.NEXT_PUBLIC_APP_URL = saved.URL;
    }
  });
});

describe("cookie aplikasi (audit C23)", () => {
  it("cookie sesi Supabase dan atribusi memakai secure di produksi, lax, path /", () => {
    expect(supabaseCookieOptions(true)).toMatchObject({ secure: true, sameSite: "lax", path: "/" });
    expect(supabaseCookieOptions(false)).toMatchObject({ secure: false, sameSite: "lax" });
    expect(attributionCookieOptions(true)).toMatchObject({ secure: true, httpOnly: true, sameSite: "lax", path: "/" });
    expect(attributionCookieOptions(false).secure).toBe(false);
  });
});

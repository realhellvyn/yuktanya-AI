import { describe, expect, it } from "vitest";
import { guardPath, homeFor, safeReturnTo, type Role } from "@/lib/auth/permissions";

const redirectOf = (r: ReturnType<typeof guardPath>) => (r.allow ? null : r.redirect);

describe("guardPath", () => {
  it("anonim diarahkan ke login dengan returnTo", () => {
    for (const p of ["/dashboard", "/partner", "/admin", "/api/ai/chat"]) {
      expect(redirectOf(guardPath(p, null))).toBe(`/login?returnTo=${encodeURIComponent(p)}`);
    }
  });

  it("rute publik terbuka untuk anonim", () => {
    for (const p of ["/", "/pricing", "/login", "/register"]) expect(guardPath(p, null)).toEqual({ allow: true });
  });

  it("user biasa tidak bisa ke /admin dan /partner", () => {
    expect(redirectOf(guardPath("/admin", ["user"]))).toBe("/dashboard");
    expect(redirectOf(guardPath("/partner/queue", ["user"]))).toBe("/dashboard");
    expect(guardPath("/dashboard", ["user"])).toEqual({ allow: true });
  });

  it("reviewer dan partner_admin masuk /partner, bukan /admin atau /dashboard", () => {
    for (const roles of [["user", "reviewer"], ["reviewer"], ["user", "partner_admin"]] as Role[][]) {
      expect(guardPath("/partner", roles)).toEqual({ allow: true });
      expect(redirectOf(guardPath("/admin", roles))).toBe("/partner");
      expect(redirectOf(guardPath("/dashboard", roles))).toBe("/partner");
    }
  });

  it("platform_admin hanya /admin, tanpa warisan ke /partner", () => {
    expect(guardPath("/admin/revenue", ["user", "platform_admin"])).toEqual({ allow: true });
    expect(redirectOf(guardPath("/partner", ["user", "platform_admin"]))).toBe("/admin");
  });

  it("prefix mirip tidak ikut terlindungi", () => {
    expect(guardPath("/administrator-info", null)).toEqual({ allow: true });
  });

  it("homeFor memilih prioritas admin > partner > dashboard", () => {
    expect(homeFor(["user"])).toBe("/dashboard");
    expect(homeFor(["user", "reviewer"])).toBe("/partner");
    expect(homeFor(["user", "reviewer", "platform_admin"])).toBe("/admin");
  });
});

describe("permukaan pemilik dokumen", () => {
  it("anonim diarahkan ke login; user biasa boleh; peran profesional diarahkan ke home-nya", () => {
    for (const p of ["/workspace/new", "/workspace/abc", "/documents", "/documents/x", "/vault"]) {
      expect(redirectOf(guardPath(p, null))).toBe(`/login?returnTo=${encodeURIComponent(p)}`);
      expect(guardPath(p, ["user"])).toEqual({ allow: true });
      expect(redirectOf(guardPath(p, ["user", "reviewer"]))).toBe("/partner");
      expect(redirectOf(guardPath(p, ["user", "platform_admin"]))).toBe("/admin");
    }
  });

  it("/api/documents mengikuti aturan permukaan pemilik: peran profesional/admin ditolak", () => {
    expect(redirectOf(guardPath("/api/documents/versions/x", null))).toContain("/login");
    expect(guardPath("/api/documents/versions/x", ["user"])).toEqual({ allow: true });
    expect(redirectOf(guardPath("/api/documents/versions/x", ["user", "reviewer"]))).toBe("/partner");
    expect(redirectOf(guardPath("/api/documents", ["user", "platform_admin"]))).toBe("/admin");
  });

  it("prefix mirip tidak ikut terlindungi", () => {
    expect(guardPath("/documentsx", null)).toEqual({ allow: true });
    expect(guardPath("/vaultish", null)).toEqual({ allow: true });
  });
});

describe("safeReturnTo", () => {
  it("menerima path internal", () => {
    expect(safeReturnTo("/dashboard")).toBe("/dashboard");
    expect(safeReturnTo("/documents/abc?x=1")).toBe("/documents/abc?x=1");
  });

  it.each(["//evil.com", "https://evil.com", "javascript:alert(1)", "/\\evil.com", "/ok\nSet-Cookie:x", null, undefined, ""])(
    "menolak %j",
    (raw) => {
      expect(safeReturnTo(raw as string | null | undefined)).toBe("/dashboard");
    },
  );
});

describe("guardPath: penagihan, review, dan verifikasi", () => {
  it("permukaan pemilik baru tertutup untuk anonim dan peran profesional/admin", () => {
    for (const p of ["/membership", "/checkout/x", "/reviews", "/reviews/abc", "/api/orders", "/api/orders/x/pay", "/api/payments/mock/x/settle", "/api/reviews"]) {
      expect(redirectOf(guardPath(p, null))).toBe(`/login?returnTo=${encodeURIComponent(p)}`);
      expect(guardPath(p, ["user"])).toEqual({ allow: true });
      expect(redirectOf(guardPath(p, ["reviewer"]))).toBe("/partner");
      expect(redirectOf(guardPath(p, ["platform_admin"]))).toBe("/admin");
    }
  });

  it("webhook penyedia dan halaman verifikasi publik tetap terbuka", () => {
    for (const p of ["/api/payments/webhook/midtrans", "/verify/abc"]) expect(guardPath(p, null)).toEqual({ allow: true });
  });

  it("/api/admin hanya platform_admin dan /api/partner hanya peran profesional", () => {
    expect(guardPath("/api/admin/payments/x/confirm", ["platform_admin"])).toEqual({ allow: true });
    expect(redirectOf(guardPath("/api/admin/payments/x/confirm", ["user"]))).toBe("/dashboard");
    expect(guardPath("/api/partner/reviews", ["reviewer"])).toEqual({ allow: true });
    expect(redirectOf(guardPath("/api/partner/reviews", ["user"]))).toBe("/dashboard");
  });
});

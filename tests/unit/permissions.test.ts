import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
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

  it("/partner/team hanya untuk koordinator; reviewer saja dialihkan ke /partner", () => {
    expect(guardPath("/partner/team", ["user", "partner_admin"])).toEqual({ allow: true });
    expect(guardPath("/partner/team", ["reviewer", "partner_admin"])).toEqual({ allow: true });
    expect(redirectOf(guardPath("/partner/team", ["user", "reviewer"]))).toBe("/partner");
    expect(redirectOf(guardPath("/partner/team/x", ["reviewer"]))).toBe("/partner");
    expect(redirectOf(guardPath("/partner/team", ["user"]))).toBe("/dashboard");
    expect(redirectOf(guardPath("/partner/team", ["user", "platform_admin"]))).toBe("/admin");
    expect(guardPath("/partner/teamwork", ["reviewer"])).toEqual({ allow: true });
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
    for (const p of ["/membership", "/checkout/x", "/reviews", "/reviews/abc", "/api/orders", "/api/orders/x/pay", "/api/payments/mock/x/settle", "/api/reviews", "/api/deep/eligibility", "/api/deep/x"]) {
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

describe("guardPath: halaman publik baru dan /settings", () => {
  it("halaman publik dan alur lupa kata sandi terbuka tanpa login", () => {
    for (const p of ["/privacy", "/terms", "/bantuan", "/design-preview", "/forgot-password", "/reset-password"]) {
      expect(guardPath(p, null)).toEqual({ allow: true });
    }
  });

  it("/settings butuh login dan mengikuti permukaan pemilik", () => {
    expect(redirectOf(guardPath("/settings", null))).toBe(`/login?returnTo=${encodeURIComponent("/settings")}`);
    expect(guardPath("/settings", ["user"])).toEqual({ allow: true });
    expect(redirectOf(guardPath("/settings", ["reviewer"]))).toBe("/partner");
    expect(redirectOf(guardPath("/settings", ["platform_admin"]))).toBe("/admin");
  });
});

// Audit C (C7/C9/C21): penjaga rute tertutup secara bawaan untuk area yang butuh login.
describe("guardPath: audit keamanan C", () => {
  it("/deep-reviews dan /api/usage adalah permukaan pemilik", () => {
    for (const p of ["/deep-reviews/abc", "/api/usage"]) {
      expect(redirectOf(guardPath(p, null))).toBe(`/login?returnTo=${encodeURIComponent(p)}`);
      expect(guardPath(p, ["user"])).toEqual({ allow: true });
      expect(redirectOf(guardPath(p, ["reviewer"]))).toBe("/partner");
      expect(redirectOf(guardPath(p, ["platform_admin"]))).toBe("/admin");
    }
  });

  it("API yang tidak dikenal butuh login (tertutup bawaan); hanya job terjadwal dan webhook pembayaran yang terbuka", () => {
    for (const p of ["/api/baru", "/api/x/y", "/api"]) expect(redirectOf(guardPath(p, null))).toContain("/login");
    for (const p of ["/api/jobs/outbox", "/api/jobs/retention", "/api/payments/webhook/midtrans"]) expect(guardPath(p, null)).toEqual({ allow: true });
    expect(guardPath("/apiku", null)).toEqual({ allow: true });
  });

  it("/api/ai hanya untuk pemilik dokumen (staf tidak memakai AI pemilik)", () => {
    expect(redirectOf(guardPath("/api/ai/x", ["reviewer"]))).toBe("/partner");
    expect(redirectOf(guardPath("/api/ai/x", ["platform_admin"]))).toBe("/admin");
  });

  it("platform_admin tidak masuk /api/partner (perutean admin lewat /admin/routing)", () => {
    expect(redirectOf(guardPath("/api/partner/unassigned", ["user", "platform_admin"]))).toBe("/admin");
    expect(guardPath("/api/partner/unassigned", ["partner_admin"])).toEqual({ allow: true });
  });
});

// Setiap halaman/rute di area login harus tertutup untuk anonim; menambah rute baru tanpa penjaga membuat tes ini gagal.
describe("guardPath: semua rute aplikasi dipetakan", () => {
  const root = join(process.cwd(), "src/app");
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /^(page|route)\.tsx?$/.test(n) ? [p] : [];
  });
  const toUrl = (file: string) => "/" + relative(root, file).split(sep).slice(0, -1)
    .filter((s) => !/^\(.*\)$/.test(s)).map((s) => (s.startsWith("[") ? "x" : s)).join("/");
  const files = walk(root);
  const PUBLIC_GROUPS = ["(public)", "(auth)"];
  const PUBLIC_API = ["/api/jobs", "/api/payments/webhook"];

  it("halaman di grup (app), (admin), (partner) dan semua /api (kecuali job & webhook) menolak anonim", () => {
    const loose = files.filter((f) => {
      const rel = relative(root, f);
      const url = toUrl(f);
      const isPublic = PUBLIC_GROUPS.some((g) => rel.startsWith(g + sep)) || url === "/auth/callback"
        || PUBLIC_API.some((p) => url === p || url.startsWith(p + "/"));
      return !isPublic && guardPath(url, null).allow;
    }).map(toUrl);
    expect(loose).toEqual([]);
  });

  it("halaman publik dan alur masuk tetap terbuka untuk anonim", () => {
    const closed = files.filter((f) => PUBLIC_GROUPS.some((g) => relative(root, f).startsWith(g + sep))).map(toUrl).filter((u) => !guardPath(u, null).allow);
    expect(closed).toEqual([]);
  });

  it("rute relai LLM umum /api/ai/chat sudah dihapus", () => {
    expect(existsSync(join(root, "api/ai/chat/route.ts"))).toBe(false);
    expect(existsSync(join(process.cwd(), "src/lib/ai/handle-chat.ts"))).toBe(false);
  });
});

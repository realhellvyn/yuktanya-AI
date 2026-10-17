export type Role = "user" | "reviewer" | "partner_admin" | "platform_admin";
export type Home = "/dashboard" | "/partner" | "/admin";
export type GuardResult = { allow: true } | { allow: false; redirect: string };

// Permukaan pemilik dokumen: hanya akun pemilik biasa (peran profesional/admin memakai permukaannya sendiri).
const OWNER = [
  "/dashboard", "/workspace", "/documents", "/vault", "/membership", "/settings", "/checkout", "/reviews", "/deep-reviews", "/cases",
  "/api/documents", "/api/orders", "/api/payments/mock", "/api/reviews", "/api/deep", "/api/usage", "/api/ai",
] as const;
const PROTECTED = [...OWNER, "/partner", "/admin", "/api/admin", "/api/partner"] as const;
// API tanpa sesi pengguna: job terjadwal (rahasia CRON_SECRET) dan webhook penyedia pembayaran (Midtrans; tanda tangan + konfirmasi API status).
// API lain yang tidak terdaftar di atas tetap butuh login (tertutup bawaan) dan mengikuti aturan permukaan pemilik.
const PUBLIC_API = ["/api/jobs", "/api/payments/webhook"] as const;

const under = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

export function homeFor(roles: Role[]): Home {
  if (roles.includes("platform_admin")) return "/admin";
  if (roles.includes("reviewer") || roles.includes("partner_admin")) return "/partner";
  return "/dashboard";
}

export function guardPath(pathname: string, roles: Role[] | null): GuardResult {
  const prefix = PROTECTED.find((p) => under(pathname, p))
    ?? (under(pathname, "/api") && !PUBLIC_API.some((p) => under(pathname, p)) ? "/api" : undefined);
  if (!prefix) return { allow: true };
  if (!roles) return { allow: false, redirect: `/login?returnTo=${encodeURIComponent(pathname)}` };

  const home = homeFor(roles);
  if (prefix === "/admin" || prefix === "/api/admin") return roles.includes("platform_admin") ? { allow: true } : { allow: false, redirect: home };
  // Admin platform tidak memakai /api/partner: perutean admin hanya lewat /admin/routing (PERMISSIONS: routing, bukan kerja reviewer).
  if (prefix === "/partner" || prefix === "/api/partner") {
    const ok = roles.includes("reviewer") || roles.includes("partner_admin");
    if (!ok) return { allow: false, redirect: home };
    // Tim firma dan kasus khusus hanya untuk koordinator; reviewer saja kembali ke dashboard mitra.
    if ((under(pathname, "/partner/team") || under(pathname, "/partner/cases")) && !roles.includes("partner_admin")) return { allow: false, redirect: "/partner" };
    return { allow: true };
  }
  // Permukaan pemilik: hanya akun pemilik biasa; peran profesional/admin tidak memakai identitas pemilik yang sama.
  return home === "/dashboard" ? { allow: true } : { allow: false, redirect: home };
}

export function safeReturnTo(raw: string | null | undefined): string {
  const fallback = "/dashboard";
  if (!raw || raw[0] !== "/" || raw[1] === "/" || raw[1] === "\\") return fallback;
  if (/[\u0000-\u001f\u007f]/.test(raw)) return fallback;
  return raw;
}

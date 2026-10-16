import { createHash } from "node:crypto";
import type { Pool } from "pg";

// Pembatas percobaan auth di aplikasi (audit C12), berbasis Postgres agar berlaku lintas instance (pola sama dengan
// ai_attempt_allowed). Kunci disimpan sebagai hash SHA-256; email dan IP mentah tidak pernah masuk database.
// Batas per IP sengaja longgar: banyak pengguna seluler Indonesia berbagi IP (CGNAT). Batas ketat ada di IP+email dan email.
export type AuthAction = "login" | "signup" | "reset" | "resend";
export type AuthDim = "ip_email" | "ip" | "email";
export type AuthLimitRule = { dim: AuthDim; limit: number; windowSeconds: number };
export type AuthLimits = Record<AuthAction, AuthLimitRule[]>;

// Batas rekayasa (bukan kebijakan produk); disetujui ulang bersama CAPTCHA/batas Supabase Auth sebelum pilot.
export const DEFAULT_AUTH_LIMITS: AuthLimits = {
  login: [{ dim: "ip_email", limit: 10, windowSeconds: 900 }, { dim: "ip", limit: 100, windowSeconds: 900 }],
  signup: [{ dim: "ip_email", limit: 5, windowSeconds: 3600 }, { dim: "email", limit: 5, windowSeconds: 3600 }, { dim: "ip", limit: 100, windowSeconds: 3600 }],
  reset: [{ dim: "ip_email", limit: 5, windowSeconds: 3600 }, { dim: "email", limit: 5, windowSeconds: 3600 }, { dim: "ip", limit: 50, windowSeconds: 3600 }],
  resend: [{ dim: "ip_email", limit: 5, windowSeconds: 3600 }, { dim: "email", limit: 5, windowSeconds: 3600 }, { dim: "ip", limit: 50, windowSeconds: 3600 }],
};

export function authLimitKey(dim: AuthDim, ip: string, email: string): string {
  const parts = [dim, dim === "email" ? "" : ip, dim === "ip" ? "" : email.trim().toLowerCase()];
  return createHash("sha256").update(`yuktanya-auth|${parts.join("|")}`).digest("hex");
}

// IP klien dari header proxy tepercaya. Di Vercel, x-real-ip dan nilai pertama x-forwarded-for diisi oleh platform.
// Di host lain header ini dapat dipalsukan; batas per email tetap berlaku.
export function clientIp(h: { get(name: string): string | null }): string {
  const real = h.get("x-real-ip")?.trim();
  if (real) return real.slice(0, 64);
  const first = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return first ? first.slice(0, 64) : "unknown";
}

export interface AuthLimiter {
  // true = boleh dicoba (dan dihitung); false = terlalu sering.
  allow(action: AuthAction, ip: string, email: string, now?: Date): Promise<boolean>;
}

export function createPgAuthLimiter(pool: Pool, limits: AuthLimits = DEFAULT_AUTH_LIMITS): AuthLimiter {
  return {
    async allow(action, ip, email, now = new Date()) {
      for (const rule of limits[action]) {
        const { rows } = await pool.query("select auth_attempt_allowed($1, $2, $3, $4, $5) as ok",
          [`${action}:${rule.dim}`, authLimitKey(rule.dim, ip, email), rule.limit, rule.windowSeconds, now]);
        if (rows[0].ok !== true) return false;
      }
      return true;
    },
  };
}

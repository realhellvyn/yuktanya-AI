// Header keamanan (audit C22). Dipakai oleh proxy (CSP dengan nonce per permintaan) dan next.config.ts (header statis).
// Hanya impor relatif/tanpa alias: berkas ini juga dimuat oleh next.config.ts.
//
// Keputusan CSP:
// - Skrip: nonce per permintaan + 'strict-dynamic'. Next.js menempelkan nonce ke skrip framework dan skrip inline-nya sendiri
//   bila CSP ada di header permintaan, jadi semua halaman dirender dinamis (root layout memanggil connection()).
// - Gaya: 'unsafe-inline' DIBIARKAN hanya untuk style-src. Alasannya: komponen memakai atribut style React (lebar bilah
//   progres) dan Next/React dapat menyisipkan <style> inline; nonce tidak berlaku untuk atribut style, dan bila nonce ada di
//   style-src, browser mengabaikan 'unsafe-inline'. Risiko gaya inline jauh lebih kecil daripada skrip (tidak menjalankan kode).
// - Hanya di luar produksi (next dev/E2E): 'unsafe-eval' (React dev memakai eval untuk jejak galat) dan ws: untuk HMR.
export type CspOptions = { nonce: string; production: boolean; supabaseUrl?: string; googleAuth?: boolean };

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function buildCsp({ nonce, production, supabaseUrl, googleAuth }: CspOptions): string {
  const supabase = originOf(supabaseUrl);
  const formAction = ["'self'", ...(googleAuth && supabase ? [supabase, "https://accounts.google.com"] : [])];
  const directives: [string, string[]][] = [
    ["default-src", ["'self'"]],
    ["script-src", ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(production ? [] : ["'unsafe-eval'"])]],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:"]],
    ["font-src", ["'self'"]],
    ["connect-src", ["'self'", ...(supabase ? [supabase] : []), ...(production ? [] : ["ws:"])]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", formAction],
    ["frame-ancestors", ["'none'"]],
    ...(production ? [["upgrade-insecure-requests", []] as [string, string[]]] : []),
  ];
  return directives.map(([k, v]) => [k, ...v].join(" ")).join("; ");
}

// 128 bit acak, base64 (Web Crypto: berjalan di runtime Node maupun edge).
export function cspNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

export function staticSecurityHeaders({ production }: { production: boolean }): { key: string; value: string }[] {
  return [
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
    // HSTS hanya di produksi (https). Tanpa preload: daftar preload butuh keputusan domain dan sulit dibatalkan.
    ...(production ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
  ];
}

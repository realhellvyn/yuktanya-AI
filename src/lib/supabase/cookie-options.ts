// Opsi cookie sesi Supabase (audit C23). httpOnly tetap false sesuai desain @supabase/ssr; secure wajib di produksi.
export function supabaseCookieOptions(production: boolean = process.env.NODE_ENV === "production") {
  return { path: "/", sameSite: "lax" as const, secure: production };
}

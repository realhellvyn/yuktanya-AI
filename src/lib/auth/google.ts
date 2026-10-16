// Tombol Google hanya tampil bila diaktifkan eksplisit (provider harus sudah dikonfigurasi di Supabase Auth).
export function googleAuthEnabled(env: Record<string, string | undefined>): boolean {
  return env.NEXT_PUBLIC_GOOGLE_AUTH === "true";
}

export function googleRedirectTo(origin: string, returnTo: string): string {
  return `${origin}/auth/callback?next=${encodeURIComponent(returnTo)}`;
}

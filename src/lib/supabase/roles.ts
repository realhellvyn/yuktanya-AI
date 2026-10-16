import type { SupabaseClient } from "@supabase/supabase-js";
import type { Role } from "@/lib/auth/permissions";

export type SessionRoles = { userId: string; roles: Role[] };

// Peran dibaca dari tabel user_roles lewat sesi pengguna (RLS: hanya miliknya), bukan dari metadata JWT.
export async function fetchSessionRoles(supabase: SupabaseClient): Promise<SessionRoles | null> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  const { data: rows } = await supabase.from("user_roles").select("role");
  return { userId: data.user.id, roles: (rows ?? []).map((r) => r.role as Role) };
}

export function hasSupabaseEnv(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

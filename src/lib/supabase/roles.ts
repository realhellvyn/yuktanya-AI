import type { SupabaseClient } from "@supabase/supabase-js";
import type { Role } from "@/lib/auth/permissions";

export type SessionRoles = { userId: string; roles: Role[] };

// Peran dibaca dari tabel user_roles lewat sesi pengguna (RLS: hanya miliknya), bukan dari metadata JWT.
export async function fetchSessionRoles(supabase: SupabaseClient): Promise<SessionRoles | null> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  const { data: rows, error } = await supabase.from("user_roles").select("role");
  // Setiap akun hidup punya minimal peran 'user' (trigger pendaftaran). Tanpa peran sama sekali = akun sudah dihapus
  // (erase_account mencabut semua peran), diperlakukan seperti tidak masuk walau token Auth masih sah.
  if (!error && Array.isArray(rows) && rows.length === 0) return null;
  return { userId: data.user.id, roles: (rows ?? []).map((r) => r.role as Role) };
}

export function hasSupabaseEnv(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

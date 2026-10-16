import "server-only";
import { redirect } from "next/navigation";
import { homeFor } from "@/lib/auth/permissions";
import { getSessionRoles } from "@/lib/supabase/server";

// Hanya akun pemilik biasa; peran profesional/admin diarahkan ke permukaannya sendiri.
export async function requireUserId(): Promise<string> {
  const s = await getSessionRoles();
  if (!s) redirect("/login");
  const home = homeFor(s.roles);
  if (home !== "/dashboard") redirect(home);
  return s.userId;
}

import { redirect } from "next/navigation";
import { guardPath } from "./permissions";
import type { SessionRoles } from "@/lib/supabase/roles";

// Pertahanan berlapis: layout memeriksa ulang akses, tidak hanya bergantung pada proxy.
export async function requireAccess(pathname: string, getRoles: () => Promise<SessionRoles | null>): Promise<void> {
  const session = await getRoles();
  const verdict = guardPath(pathname, session?.roles ?? null);
  if (!verdict.allow) redirect(verdict.redirect);
}

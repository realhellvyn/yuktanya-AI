import { requireAccess } from "@/lib/auth/require-access";
import { getSessionRoles } from "@/lib/supabase/server";

export default async function VaultLayout({ children }: { children: React.ReactNode }) {
  await requireAccess("/vault", getSessionRoles);
  return children;
}

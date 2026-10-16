import { RoleShell } from "@/components/role-shell";
import { requireAccess } from "@/lib/auth/require-access";
import { ADMIN_NAV } from "@/lib/admin/nav";
import { getSessionRoles } from "@/lib/supabase/server";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAccess("/admin", getSessionRoles);
  return <RoleShell root="/admin" area="Admin Platform" items={ADMIN_NAV}>{children}</RoleShell>;
}

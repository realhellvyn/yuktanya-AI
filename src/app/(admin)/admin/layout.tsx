import { requireAccess } from "@/lib/auth/require-access";
import { getSessionRoles } from "@/lib/supabase/server";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAccess("/admin", getSessionRoles);
  return children;
}

import { requireAccess } from "@/lib/auth/require-access";
import { getSessionRoles } from "@/lib/supabase/server";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  await requireAccess("/dashboard", getSessionRoles);
  return children;
}

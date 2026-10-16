import { requireAccess } from "@/lib/auth/require-access";
import { getSessionRoles } from "@/lib/supabase/server";

export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireAccess("/reviews", getSessionRoles);
  return children;
}

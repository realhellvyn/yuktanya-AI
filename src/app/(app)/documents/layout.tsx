import { requireAccess } from "@/lib/auth/require-access";
import { getSessionRoles } from "@/lib/supabase/server";

export default async function DocumentsLayout({ children }: { children: React.ReactNode }) {
  await requireAccess("/documents", getSessionRoles);
  return children;
}

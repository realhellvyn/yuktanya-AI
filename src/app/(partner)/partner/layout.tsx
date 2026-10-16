import { requireAccess } from "@/lib/auth/require-access";
import { getSessionRoles } from "@/lib/supabase/server";

export default async function PartnerLayout({ children }: { children: React.ReactNode }) {
  await requireAccess("/partner", getSessionRoles);
  return children;
}

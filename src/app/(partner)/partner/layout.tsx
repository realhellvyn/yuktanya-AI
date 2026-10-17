import { RoleShell } from "@/components/role-shell";
import { requireAccess } from "@/lib/auth/require-access";
import { getSessionRoles } from "@/lib/supabase/server";

export default async function PartnerLayout({ children }: { children: React.ReactNode }) {
  const session = await getSessionRoles();
  await requireAccess("/partner", async () => session);
  const s = session!;
  const items = [
    { href: "/partner", label: "Antrean pekerjaan" },
    ...(s.roles.includes("reviewer") ? [{ href: "/partner/approvals", label: "Siap diputuskan" }] : []),
    ...(s.roles.includes("partner_admin") ? [{ href: "/partner/team", label: "Tim firma" }, { href: "/partner/cases", label: "Special Legal Case" }] : []),
  ];
  return <RoleShell root="/partner" area="Mitra Hukum" items={items}>{children}</RoleShell>;
}

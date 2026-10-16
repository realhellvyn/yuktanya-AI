import { redirect } from "next/navigation";
import { homeFor, type Role } from "@/lib/auth/permissions";
import type { SessionRoles } from "@/lib/supabase/roles";
import { getSessionRoles } from "@/lib/supabase/server";

// Pemeriksaan peran sesi untuk aksi server mitra (pertahanan berlapis; kewenangan akhir tetap diperiksa di database).
// reviewer: menulis, menerbitkan, dan memutuskan (admin dan koordinator saja tidak pernah). coordinator: mencatat konflik
// firma. routing: menugaskan/memindahkan (koordinator firma atau admin platform untuk perutean operasional).
export type PartnerNeed = "reviewer" | "coordinator" | "routing";

export function partnerRoleOk(need: PartnerNeed, roles: Role[]): boolean {
  if (need === "reviewer") return roles.includes("reviewer");
  if (need === "coordinator") return roles.includes("partner_admin");
  return roles.includes("partner_admin") || roles.includes("platform_admin");
}

export async function partnerActor(need: PartnerNeed): Promise<SessionRoles> {
  const s = await getSessionRoles();
  if (!s) redirect("/login");
  if (!partnerRoleOk(need, s.roles)) redirect(homeFor(s.roles));
  return s;
}

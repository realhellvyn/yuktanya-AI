"use server";

import { redirect } from "next/navigation";
import { getPool } from "@/lib/db";
import { adminService } from "@/lib/admin/runtime";
import { getSessionRoles } from "@/lib/supabase/server";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
async function admin() {
  const s = await getSessionRoles();
  if (!s || !s.roles.includes("platform_admin")) redirect("/login");
  return s.userId;
}
const back = (q: string): never => redirect(`/admin/partners?${q}`);
function code(e: unknown): string {
  const m = e instanceof Error ? e.message : "";
  for (const c of ["SELF_GRANT", "FORBIDDEN", "NOT_A_MEMBER"]) if (m.includes(c)) return c;
  throw e;
}

export async function registerFirmAction(formData: FormData): Promise<void> {
  const id = await admin();
  const name = str(formData, "name");
  if (name.length < 2) back("e=NAME");
  await getPool().query("select admin_register_firm($1, $2, $3)", [id, name, formData.get("isDefault") === "yes"]);
  back("ok=firm");
}

export async function addMemberAction(formData: FormData): Promise<void> {
  const id = await admin();
  const userId = await adminService().findUser(id, str(formData, "email"));
  if (!userId) back("e=NO_USER");
  const role = str(formData, "role") === "coordinator" ? "coordinator" : "reviewer";
  try {
    await getPool().query("select admin_add_member($1, $2, $3, $4)", [id, str(formData, "firmId"), userId, role]);
  } catch (e) {
    back(`e=${code(e)}`);
  }
  back("ok=member");
}

export async function authorizeAction(formData: FormData): Promise<void> {
  const id = await admin();
  const [from, to] = [str(formData, "validFrom"), str(formData, "validTo")];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) back("e=DATES");
  const userId = await adminService().findUser(id, str(formData, "email"));
  if (!userId) back("e=NO_USER");
  try {
    await getPool().query("select admin_authorize($1, $2, $3, $4, $5, $6)", [id, userId, str(formData, "firmId"), str(formData, "scope") || "Lingkup belum dirinci", from, to]);
  } catch (e) {
    back(`e=${code(e)}`);
  }
  back("ok=auth");
}

export async function revokeAuthorizationAction(formData: FormData): Promise<void> {
  const id = await admin();
  await getPool().query("select admin_revoke_authorization($1, $2, $3)", [id, str(formData, "authId"), new Date()]);
  back("ok=revoked");
}

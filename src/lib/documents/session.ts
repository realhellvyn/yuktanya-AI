import "server-only";
import { redirect } from "next/navigation";
import { getSessionRoles } from "@/lib/supabase/server";

export async function requireUserId(): Promise<string> {
  const s = await getSessionRoles();
  if (!s) redirect("/login");
  return s.userId;
}

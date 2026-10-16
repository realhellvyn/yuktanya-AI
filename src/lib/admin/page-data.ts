import "server-only";
import { redirect } from "next/navigation";
import { getSessionRoles } from "@/lib/supabase/server";
import { parseRange } from "./format";
import { adminService } from "./runtime";

// Semua halaman metrik: sesi platform_admin diperiksa ulang (selain proxy dan layout), lalu metrik diambil lewat fungsi DB yang juga memeriksa peran.
export async function loadOverview(q: { r?: string }) {
  const s = await getSessionRoles();
  if (!s || !s.roles.includes("platform_admin")) redirect("/login");
  const range = parseRange(q);
  return { o: await adminService().overview(s.userId, range.from, range.to), range };
}

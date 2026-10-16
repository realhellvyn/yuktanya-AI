import "server-only";
import { redirect } from "next/navigation";
import { getSessionRoles } from "@/lib/supabase/server";
import { parseAnalyticsQuery } from "./analytics";
import { parseRange } from "./format";
import { adminService } from "./runtime";

// Semua halaman metrik: sesi platform_admin diperiksa ulang (selain proxy dan layout), lalu metrik diambil lewat fungsi DB yang juga memeriksa peran.
export async function loadOverview(q: { r?: string }) {
  const s = await getSessionRoles();
  if (!s || !s.roles.includes("platform_admin")) redirect("/login");
  const range = parseRange(q);
  return { o: await adminService().overview(s.userId, range.from, range.to), range };
}

// Analitik: rentang khusus/preset + filter, ditambah periode pembanding sama panjang tepat sebelumnya.
export async function loadAnalytics(q: { r?: string; dari?: string; sampai?: string; jenis?: string; anggota?: string }) {
  const s = await getSessionRoles();
  if (!s || !s.roles.includes("platform_admin")) redirect("/login");
  const query = parseAnalyticsQuery(q);
  const svc = adminService();
  const [current, previous, o] = await Promise.all([
    svc.analytics(s.userId, query.from, query.to, query.category, query.membership),
    svc.analytics(s.userId, query.prevFrom, query.prevTo, query.category, query.membership),
    svc.overview(s.userId, query.from, query.to),
  ]);
  return { query, current, previous, o };
}

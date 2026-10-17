import { homeFor } from "@/lib/auth/permissions";
import { getPool } from "@/lib/db";
import { accountExportHandler, loadAccountExport } from "@/lib/retention/export";
import { rateLimiter } from "@/lib/security/limiters";
import { getSessionRoles } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Unduh data saya: hanya akun pemilik yang sedang masuk; isi dari export_account_data (milik sendiri saja).
export async function GET(req: Request): Promise<Response> {
  return accountExportHandler({
    getUserId: async () => {
      const s = await getSessionRoles();
      return s && homeFor(s.roles) === "/dashboard" ? s.userId : null;
    },
    load: (userId, now) => loadAccountExport(getPool(), userId, now),
    // 5 kali per jam per akun, lintas instance (DB); gagal DB = ditolak (fail-closed).
    allow: (userId) => rateLimiter("account_export").allow(userId),
  }, req);
}

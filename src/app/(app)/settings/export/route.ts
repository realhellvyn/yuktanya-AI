import { homeFor } from "@/lib/auth/permissions";
import { getPool } from "@/lib/db";
import { accountExportHandler, loadAccountExport } from "@/lib/retention/export";
import { exportLimiter } from "@/lib/retention/runtime";
import { getSessionRoles } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Unduh data saya: hanya akun pemilik yang sedang masuk; isi dari export_account_data (milik sendiri saja).
export async function GET(): Promise<Response> {
  return accountExportHandler({
    getUserId: async () => {
      const s = await getSessionRoles();
      return s && homeFor(s.roles) === "/dashboard" ? s.userId : null;
    },
    load: (userId, now) => loadAccountExport(getPool(), userId, now),
    allow: (userId) => exportLimiter.allow(userId),
  });
}

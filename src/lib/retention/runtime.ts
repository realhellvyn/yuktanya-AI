import "server-only";
import { createClient } from "@supabase/supabase-js";
import { createRateLimiter } from "@/lib/vault/rate-limit";
import type { AuthAdmin } from "./erasure";

// Supabase Admin API (service role, hanya server). Soft delete: identitas/email dihapus dan login mati, sementara ID
// akun tetap ada sebagai rujukan anonim untuk catatan pesanan/pembayaran yang wajib disimpan.
export function supabaseAuthAdmin(): AuthAdmin {
  return {
    async deleteUser(userId) {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!url || !key) throw new Error("Auth admin belum dikonfigurasi (SUPABASE_SERVICE_ROLE_KEY)");
      const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
      const { error } = await client.auth.admin.deleteUser(userId, true);
      if (error) throw new Error(`Gagal menghapus akun Auth: ${error.message}`);
    },
  };
}

// Batas unduh data: 5 kali per jam per akun (dalam memori per proses, sama seperti pembatas publik lain).
export const exportLimiter = createRateLimiter({ limit: 5, windowMs: 3_600_000 });

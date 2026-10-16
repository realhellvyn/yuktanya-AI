import "server-only";
import { getPool } from "@/lib/db";
import { parseAttribution } from "./attribution";

// Menyimpan sentuhan pertama (utm_*) ke profil lewat fungsi DB; kegagalan tidak boleh memblokir pendaftaran.
export async function recordAttribution(userId: string, cookieValue: string | undefined): Promise<void> {
  if (!cookieValue) return;
  try {
    const raw = JSON.parse(cookieValue) as Record<string, string>;
    const a = parseAttribution(new URLSearchParams(raw));
    await getPool().query("select set_attribution($1, $2, $3, $4)", [userId, a.utm_source ?? null, a.utm_campaign ?? null, a.utm_creative ?? null]);
  } catch {
    // diabaikan dengan sengaja
  }
}

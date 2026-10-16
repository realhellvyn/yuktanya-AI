// Sesi pemulihan = sesi yang lahir dari tautan email "lupa kata sandi" (klaim `amr` bermetode recovery/otp, baru saja).
// Sesi masuk biasa (kata sandi, Google) tidak boleh mengganti kata sandi tanpa kata sandi lama.
const MAX_AGE_SECONDS = 3600;

export function isRecoverySession(accessToken: string | undefined | null, now: Date = new Date()): boolean {
  try {
    const payload = JSON.parse(Buffer.from(String(accessToken ?? "").split(".")[1] ?? "", "base64url").toString());
    const amr: unknown = payload?.amr;
    if (!Array.isArray(amr)) return false;
    const nowSec = Math.floor(now.getTime() / 1000);
    return amr.some((e) => (e?.method === "recovery" || e?.method === "otp") && typeof e.timestamp === "number" && nowSec - e.timestamp <= MAX_AGE_SECONDS);
  } catch {
    return false;
  }
}

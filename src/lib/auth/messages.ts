import { z } from "zod";

// Pemetaan kesalahan Supabase Auth ke kode internal, lalu ke kalimat Indonesia sederhana.
// Kode kembali lewat ?error=<kode> sehingga tidak ada teks teknis yang sampai ke pengguna.
export type AuthErrorCode = "invalid" | "failed" | "unconfigured" | "rate_limited" | "weak_password" | "same_password" | "session_missing" | "mismatch";

export const AUTH_MESSAGES: Record<string, string> = {
  invalid: "Email atau kata sandi belum sesuai. Kata sandi minimal 8 karakter.",
  failed: "Belum berhasil. Periksa isian Anda, lalu coba lagi.",
  unconfigured: "Layanan masuk belum disiapkan di lingkungan ini.",
  rate_limited: "Terlalu sering mencoba. Tunggu beberapa menit, lalu coba lagi.",
  weak_password: "Kata sandi terlalu mudah ditebak. Pakai minimal 8 karakter dan campurkan huruf dengan angka.",
  same_password: "Kata sandi baru harus berbeda dari kata sandi yang lama.",
  session_missing: "Tautan atur ulang sudah tidak berlaku. Minta tautan baru di halaman Lupa kata sandi.",
  mismatch: "Kedua kata sandi belum sama. Ketik ulang dengan teliti.",
};

export function authErrorCode(error: { code?: string; status?: number; message?: string } | null | undefined): AuthErrorCode {
  if (!error) return "failed";
  if (error.status === 429 || (error.code ?? "").includes("rate_limit")) return "rate_limited";
  if (error.code === "weak_password") return "weak_password";
  if (error.code === "same_password") return "same_password";
  if (error.code === "session_not_found" || error.code === "session_expired" || /session missing/i.test(error.message ?? "")) return "session_missing";
  return "failed";
}

export function normalizeEmail(raw: unknown): string | null {
  const parsed = z.email().safeParse(String(raw ?? "").trim());
  return parsed.success ? parsed.data : null;
}

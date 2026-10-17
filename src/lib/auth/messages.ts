import { z } from "zod";

// Pemetaan kesalahan Supabase Auth ke kode internal, lalu ke kalimat Indonesia yang ringkas: apa yang terjadi dan langkah berikutnya.
// Kode kembali lewat ?error=<kode> sehingga tidak ada teks teknis yang sampai ke pengguna.
export type AuthErrorCode = "invalid" | "failed" | "unconfigured" | "rate_limited" | "weak_password" | "same_password" | "session_missing" | "mismatch";

export const AUTH_MESSAGES: Record<string, string> = {
  invalid: "Email atau kata sandi tidak sesuai. Periksa kembali isian Anda. Kata sandi minimal 8 karakter.",
  failed: "Permintaan belum berhasil. Periksa isian Anda, lalu coba lagi.",
  unconfigured: "Layanan masuk belum tersedia di lingkungan ini. Hubungi pengelola aplikasi.",
  rate_limited: "Terlalu banyak percobaan. Tunggu beberapa menit, lalu coba lagi.",
  weak_password: "Kata sandi terlalu mudah ditebak. Gunakan minimal 8 karakter dengan campuran huruf dan angka.",
  same_password: "Kata sandi baru harus berbeda dari kata sandi yang lama.",
  session_missing: "Tautan atur ulang sudah tidak berlaku. Minta tautan baru di halaman Lupa kata sandi.",
  mismatch: "Kedua kata sandi belum sama. Ketik ulang kata sandi baru di kedua kotak.",
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

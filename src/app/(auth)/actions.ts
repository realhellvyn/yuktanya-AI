"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { appOrigin } from "@/lib/app-url";
import { googleAuthEnabled, googleRedirectTo } from "@/lib/auth/google";
import { authLimiter } from "@/lib/auth/limiter-runtime";
import { authErrorCode, normalizeEmail } from "@/lib/auth/messages";
import { clientIp, type AuthAction } from "@/lib/auth/rate-limit";
import { isRecoverySession } from "@/lib/auth/recovery";
import { safeReturnTo } from "@/lib/auth/permissions";
import { recordAttribution } from "@/lib/auth/record-attribution";
import { trackEvent } from "@/lib/analytics/events";
import { getPool } from "@/lib/db";
import { hasSupabaseEnv } from "@/lib/supabase/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const credentials = z.object({ email: z.email(), password: z.string().min(8).max(72) });

function parse(formData: FormData) {
  const returnTo = safeReturnTo(String(formData.get("returnTo") ?? ""));
  const parsed = credentials.safeParse({
    email: String(formData.get("email") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
  });
  return { returnTo, parsed };
}

// Pembatas laju aplikasi (audit C12), sebelum Supabase dipanggil: kunci IP+email/IP/email tanpa memeriksa keberadaan akun,
// jadi jawaban "terlalu sering" sama untuk email terdaftar maupun tidak. Bila pembatas tidak dapat dihubungi (galat database
// sesaat) permintaan tidak diblokir: batas Supabase Auth tetap berlaku, dan menutup semua login karena galat sementara lebih
// merugikan. true = terlalu sering.
async function rateLimited(action: AuthAction, email: string): Promise<boolean> {
  try {
    return !(await authLimiter().allow(action, clientIp(await headers()), email.trim().toLowerCase()));
  } catch (e) {
    console.error("auth_rate_limit_unavailable", e instanceof Error ? e.name : "error");
    return false;
  }
}

const back = (page: "login" | "register", code: string, returnTo: string) =>
  redirect(`/${page}?error=${code}&returnTo=${encodeURIComponent(returnTo)}`);

export async function signIn(formData: FormData) {
  const { returnTo, parsed } = parse(formData);
  if (!parsed.success) back("login", "invalid", returnTo);
  if (!hasSupabaseEnv()) back("login", "unconfigured", returnTo);
  if (await rateLimited("login", parsed.data!.email)) back("login", "rate_limited", returnTo);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data!);
  // Pesan sama untuk semua kegagalan agar tidak membocorkan keberadaan akun.
  if (error) back("login", "failed", returnTo);
  redirect(returnTo);
}

export async function signUp(formData: FormData) {
  const { returnTo, parsed } = parse(formData);
  if (!parsed.success) back("register", "invalid", returnTo);
  if (!hasSupabaseEnv()) back("register", "unconfigured", returnTo);
  if (await rateLimited("signup", parsed.data!.email)) back("register", "rate_limited", returnTo);
  const supabase = await createSupabaseServerClient();
  const origin = appOrigin();
  const { data, error } = await supabase.auth.signUp({
    ...parsed.data!,
    options: { emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(returnTo)}` },
  });
  if (error) back("register", "failed", returnTo);
  if (data?.user) {
    await recordAttribution(data.user.id, (await cookies()).get("yk_attr")?.value);
    // Juga ditulis trigger DB saat profil dibuat (kunci dedupe sama); di sini hanya cadangan best-effort.
    await trackEvent(getPool(), { name: "signup_completed", actorUserId: data.user.id, entityType: "user", entityId: data.user.id, dedupeKey: `signup:${data.user.id}` });
  }
  redirect(data?.session ? returnTo : "/register?sent=1");
}

export async function signInWithGoogle(formData: FormData) {
  const returnTo = safeReturnTo(String(formData.get("returnTo") ?? ""));
  if (!googleAuthEnabled(process.env) || !hasSupabaseEnv()) back("login", "unconfigured", returnTo);
  const supabase = await createSupabaseServerClient();
  const origin = appOrigin();
  const { data, error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: googleRedirectTo(origin, returnTo) } });
  if (error || !data.url) back("login", "failed", returnTo);
  redirect(data!.url!);
}

export async function signOut(): Promise<void> {
  if (hasSupabaseEnv()) await (await createSupabaseServerClient()).auth.signOut();
  redirect("/");
}

// Lupa kata sandi: jawaban sukses sama untuk email terdaftar maupun tidak (tidak membocorkan keberadaan akun).
export async function requestPasswordReset(formData: FormData) {
  const email = normalizeEmail(formData.get("email"));
  if (!email) redirect("/forgot-password?error=invalid");
  if (!hasSupabaseEnv()) redirect("/forgot-password?error=unconfigured");
  if (await rateLimited("reset", email!)) redirect("/forgot-password?error=rate_limited");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email!, {
    redirectTo: `${appOrigin()}/auth/callback?next=${encodeURIComponent("/reset-password")}`,
  });
  // Semua hasil (termasuk batas kirim per email) dijawab sama agar keberadaan akun tidak bocor.
  void error;
  redirect("/forgot-password?sent=1");
}

// Dipakai setelah pengguna membuka tautan dari email (sesi pemulihan dibuat oleh /auth/callback).
export async function updatePassword(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (password.length < 8 || password.length > 72) redirect("/reset-password?error=invalid");
  if (password !== confirm) redirect("/reset-password?error=mismatch");
  if (!hasSupabaseEnv()) redirect("/reset-password?error=unconfigured");
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/reset-password?error=session_missing");
  // Hanya sesi dari tautan pemulihan email; sesi masuk biasa tidak boleh mengganti kata sandi tanpa kata sandi lama.
  const { data: sess } = await supabase.auth.getSession();
  if (!isRecoverySession(sess.session?.access_token)) redirect("/reset-password?error=session_missing");
  const { error } = await supabase.auth.updateUser({ password });
  if (error) redirect(`/reset-password?error=${authErrorCode(error)}`);
  redirect("/reset-password?done=1");
}

// Kirim ulang email konfirmasi dari halaman masuk/daftar.
export async function resendConfirmation(formData: FormData) {
  const page = formData.get("page") === "register" ? "register" : "login";
  const returnTo = safeReturnTo(String(formData.get("returnTo") ?? ""));
  const email = normalizeEmail(formData.get("email"));
  const to = (q: string) => redirect(`/${page}?${q}&returnTo=${encodeURIComponent(returnTo)}`);
  if (!email) to("error=invalid");
  if (!hasSupabaseEnv()) to("error=unconfigured");
  if (await rateLimited("resend", email!)) to("error=rate_limited");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email: email!,
    options: { emailRedirectTo: `${appOrigin()}/auth/callback?next=${encodeURIComponent(returnTo)}` },
  });
  if (error) to(`error=${authErrorCode(error)}`);
  to("resent=1");
}

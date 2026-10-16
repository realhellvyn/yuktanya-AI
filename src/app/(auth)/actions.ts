"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { googleAuthEnabled, googleRedirectTo } from "@/lib/auth/google";
import { authErrorCode, normalizeEmail } from "@/lib/auth/messages";
import { safeReturnTo } from "@/lib/auth/permissions";
import { recordAttribution } from "@/lib/auth/record-attribution";
import { recordEvent } from "@/lib/analytics/events";
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

const back = (page: "login" | "register", code: string, returnTo: string) =>
  redirect(`/${page}?error=${code}&returnTo=${encodeURIComponent(returnTo)}`);

export async function signIn(formData: FormData) {
  const { returnTo, parsed } = parse(formData);
  if (!parsed.success) back("login", "invalid", returnTo);
  if (!hasSupabaseEnv()) back("login", "unconfigured", returnTo);
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
  const supabase = await createSupabaseServerClient();
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const { data, error } = await supabase.auth.signUp({
    ...parsed.data!,
    options: { emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(returnTo)}` },
  });
  if (error) back("register", "failed", returnTo);
  if (data?.user) {
    await recordAttribution(data.user.id, (await cookies()).get("yk_attr")?.value);
    await recordEvent(getPool(), { name: "signup_completed", actorUserId: data.user.id, dedupeKey: `signup:${data.user.id}` }).catch(() => undefined);
  }
  redirect(data?.session ? returnTo : "/register?sent=1");
}

export async function signInWithGoogle(formData: FormData) {
  const returnTo = safeReturnTo(String(formData.get("returnTo") ?? ""));
  if (!googleAuthEnabled(process.env) || !hasSupabaseEnv()) back("login", "unconfigured", returnTo);
  const supabase = await createSupabaseServerClient();
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const { data, error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: googleRedirectTo(origin, returnTo) } });
  if (error || !data.url) back("login", "failed", returnTo);
  redirect(data!.url!);
}

export async function signOut(): Promise<void> {
  if (hasSupabaseEnv()) await (await createSupabaseServerClient()).auth.signOut();
  redirect("/");
}

const appOrigin = () => process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

// Lupa kata sandi: jawaban sukses sama untuk email terdaftar maupun tidak (tidak membocorkan keberadaan akun).
export async function requestPasswordReset(formData: FormData) {
  const email = normalizeEmail(formData.get("email"));
  if (!email) redirect("/forgot-password?error=invalid");
  if (!hasSupabaseEnv()) redirect("/forgot-password?error=unconfigured");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email!, {
    redirectTo: `${appOrigin()}/auth/callback?next=${encodeURIComponent("/reset-password")}`,
  });
  if (error) {
    const code = authErrorCode(error);
    // Hanya kegagalan yang tidak terkait akun yang ditampilkan; selebihnya tetap dijawab "terkirim".
    if (code === "rate_limited") redirect("/forgot-password?error=rate_limited");
  }
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
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email: email!,
    options: { emailRedirectTo: `${appOrigin()}/auth/callback?next=${encodeURIComponent(returnTo)}` },
  });
  if (error) to(`error=${authErrorCode(error)}`);
  to("resent=1");
}

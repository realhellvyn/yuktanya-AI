"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { googleAuthEnabled, googleRedirectTo } from "@/lib/auth/google";
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

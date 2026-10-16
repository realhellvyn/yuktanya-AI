import { NextResponse, type NextRequest } from "next/server";
import { recordAttribution } from "@/lib/auth/record-attribution";
import { safeReturnTo } from "@/lib/auth/permissions";
import { hasSupabaseEnv } from "@/lib/supabase/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = safeReturnTo(searchParams.get("next"));
  const code = searchParams.get("code");
  if (code && hasSupabaseEnv()) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Pendaftaran via Google tidak lewat signUp; sentuhan pertama tetap dicatat (fungsi DB hanya menyimpan sekali).
      const { data } = await supabase.auth.getUser();
      if (data.user) await recordAttribution(data.user.id, request.cookies.get("yk_attr")?.value);
      return NextResponse.redirect(new URL(next, origin));
    }
  }
  return NextResponse.redirect(new URL("/login?error=failed", origin));
}

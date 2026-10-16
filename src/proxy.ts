import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { guardPath } from "@/lib/auth/permissions";
import { parseAttribution } from "@/lib/auth/attribution";
import { fetchSessionRoles, hasSupabaseEnv, type SessionRoles } from "@/lib/supabase/roles";

export async function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  let response = NextResponse.next({ request });

  let session: SessionRoles | null = null;
  const protectedPath = !guardPath(pathname, null).allow;
  if (protectedPath && hasSupabaseEnv()) {
    const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    });
    session = await fetchSessionRoles(supabase);
  }

  if (protectedPath) {
    const verdict = guardPath(pathname, session?.roles ?? null);
    if (!verdict.allow) {
      if (pathname.startsWith("/api/")) {
        return session
          ? NextResponse.json({ code: "FORBIDDEN" }, { status: 403 })
          : NextResponse.json({ code: "AUTH_REQUIRED" }, { status: 401 });
      }
      return NextResponse.redirect(new URL(verdict.redirect, request.url));
    }
  }

  // Atribusi sumber iklan: sentuhan pertama disimpan di cookie sampai pendaftaran.
  const attribution = parseAttribution(searchParams);
  if (Object.keys(attribution).length > 0 && !request.cookies.get("yk_attr")) {
    response.cookies.set("yk_attr", JSON.stringify(attribution), {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
    });
  }
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { guardPath } from "@/lib/auth/permissions";
import { attributionCookieOptions, parseAttribution } from "@/lib/auth/attribution";
import { googleAuthEnabled } from "@/lib/auth/google";
import { buildCsp, cspNonce } from "@/lib/security/headers";
import { supabaseCookieOptions } from "@/lib/supabase/cookie-options";
import { fetchSessionRoles, hasSupabaseEnv, type SessionRoles } from "@/lib/supabase/roles";

export async function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  // CSP dengan nonce per permintaan (audit C22): Next.js membaca nonce dari header CSP permintaan dan menempelkannya ke
  // skripnya sendiri; header yang sama dikirim ke browser.
  const csp = buildCsp({
    nonce: cspNonce(),
    production: process.env.NODE_ENV === "production",
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    googleAuth: googleAuthEnabled(process.env),
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("content-security-policy", csp);
  const next = () => NextResponse.next({ request: { headers: requestHeaders } });
  const withCsp = <T extends NextResponse>(res: T): T => {
    res.headers.set("Content-Security-Policy", csp);
    return res;
  };
  let response = next();

  let session: SessionRoles | null = null;
  const protectedPath = !guardPath(pathname, null).allow;
  if (protectedPath && hasSupabaseEnv()) {
    const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      cookieOptions: supabaseCookieOptions(),
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          requestHeaders.set("cookie", request.headers.get("cookie") ?? "");
          response = next();
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
      return withCsp(NextResponse.redirect(new URL(verdict.redirect, request.url)));
    }
  }

  // Atribusi sumber iklan: sentuhan pertama disimpan di cookie sampai pendaftaran.
  const attribution = parseAttribution(searchParams);
  if (Object.keys(attribution).length > 0 && !request.cookies.get("yk_attr")) {
    response.cookies.set("yk_attr", JSON.stringify(attribution), attributionCookieOptions());
  }
  return withCsp(response);
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };

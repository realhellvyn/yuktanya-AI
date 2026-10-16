import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { supabaseCookieOptions } from "./cookie-options";
import { fetchSessionRoles, hasSupabaseEnv, type SessionRoles } from "./roles";

export async function createSupabaseServerClient() {
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookieOptions: supabaseCookieOptions(),
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Dipanggil dari Server Component: sesi disegarkan oleh proxy.
        }
      },
    },
  });
}

export async function getSessionRoles(): Promise<SessionRoles | null> {
  if (!hasSupabaseEnv()) return null;
  return fetchSessionRoles(await createSupabaseServerClient());
}

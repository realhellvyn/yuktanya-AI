import { safeReturnTo } from "@/lib/auth/permissions";
import { AuthForm } from "../auth-form";
import { signIn } from "../actions";

export const metadata = { title: "Masuk | Yuktanya" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  return <AuthForm mode="login" action={signIn} error={q.error} sent={q.sent === "1"} resent={q.resent === "1"} returnTo={safeReturnTo(q.returnTo)} />;
}

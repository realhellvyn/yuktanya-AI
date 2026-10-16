import { safeReturnTo } from "@/lib/auth/permissions";
import { AuthForm } from "../auth-form";
import { signUp } from "../actions";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  return <AuthForm mode="register" action={signUp} error={q.error} sent={q.sent === "1"} resent={q.resent === "1"} returnTo={safeReturnTo(q.returnTo)} />;
}

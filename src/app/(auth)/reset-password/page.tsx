import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AUTH_MESSAGES } from "@/lib/auth/messages";
import { isRecoverySession } from "@/lib/auth/recovery";
import { hasSupabaseEnv } from "@/lib/supabase/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { updatePassword } from "../actions";
import { AuthShell, linkClass } from "../auth-shell";
import { fixedText } from "@/lib/query-text";

export const metadata = { title: "Kata sandi baru | Yuktanya" };
export const dynamic = "force-dynamic";

const field = "mt-2 block min-h-12 w-full rounded-xl border border-border-strong bg-surface px-4 text-lg";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  if (q.done === "1") {
    return (
      <AuthShell title="Kata sandi baru">
        <p role="status" className="rounded-xl border border-green-300 bg-green-50 p-4 text-green-900"><strong>Kata sandi berhasil diganti.</strong> Gunakan kata sandi baru saat masuk berikutnya.</p>
        <Link className={linkClass} href="/dashboard">Lanjut ke Beranda</Link>
      </AuthShell>
    );
  }
  // Halaman ini hanya berguna dengan sesi pemulihan dari tautan email.
  const supabase = hasSupabaseEnv() ? await createSupabaseServerClient() : null;
  const user = supabase ? (await supabase.auth.getUser()).data.user : null;
  const recovery = user && supabase ? isRecoverySession((await supabase.auth.getSession()).data.session?.access_token) : false;
  if (!user || !recovery) {
    return (
      <AuthShell title="Kata sandi baru" footer={<Link className={linkClass} href="/login">Kembali ke halaman masuk</Link>}>
        <p role="alert" className="rounded-xl border border-amber-400 bg-amber-50 p-4 text-amber-900">{AUTH_MESSAGES.session_missing}</p>
        <Link className={linkClass} href="/forgot-password">Minta tautan baru</Link>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Buat kata sandi baru">
      {q.error && <p role="alert" className="rounded-xl border border-danger bg-red-50 p-4 font-semibold text-danger">{q.error === "invalid" ? "Kata sandi minimal 8 karakter." : fixedText(AUTH_MESSAGES, q.error) ?? AUTH_MESSAGES.failed}</p>}
      <form action={updatePassword} className="space-y-5">
        <label className="block">
          <span className="font-semibold">Kata sandi baru <span className="font-normal text-muted">(Wajib, minimal 8 karakter)</span></span>
          <input name="password" type="password" required minLength={8} maxLength={72} autoComplete="new-password" className={field} />
        </label>
        <label className="block">
          <span className="font-semibold">Ketik ulang kata sandi baru <span className="font-normal text-muted">(Wajib)</span></span>
          <input name="confirm" type="password" required minLength={8} maxLength={72} autoComplete="new-password" className={field} />
        </label>
        <Button type="submit" className="w-full text-lg">Simpan kata sandi baru</Button>
      </form>
    </AuthShell>
  );
}

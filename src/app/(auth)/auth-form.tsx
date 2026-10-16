import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { googleAuthEnabled } from "@/lib/auth/google";
import { AUTH_MESSAGES } from "@/lib/auth/messages";
import { resendConfirmation, signInWithGoogle } from "./actions";
import { PasswordField } from "./password-field";


type Props = {
  mode: "login" | "register";
  action: (formData: FormData) => Promise<void>;
  error?: string;
  sent?: boolean;
  resent?: boolean;
  returnTo: string;
};

export function AuthForm({ mode, action, error, sent, resent, returnTo }: Props) {
  const isLogin = mode === "login";
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4 py-10">
      <Link href="/" className="inline-flex min-h-12 items-center self-start text-2xl font-bold tracking-tight text-navy">Yuktanya</Link>
      <Card className="space-y-5 !p-6 md:!p-8">
        <h1 className="text-[1.75rem] font-bold leading-tight text-navy">{isLogin ? "Masuk ke Yuktanya" : "Buat akun Yuktanya"}</h1>
        {sent && (
          <p role="status" className="rounded-xl border border-blue-300 bg-blue-50 p-4">
            Kami sudah mengirim email konfirmasi. Buka email Anda lalu tekan tautannya. Belum menerima? Periksa folder spam, lalu kirim ulang lewat kotak di bawah.
          </p>
        )}
        {resent && (
          <p role="status" className="rounded-xl border border-green-300 bg-green-50 p-4 font-semibold text-green-900">
            Email konfirmasi dikirim ulang. Periksa kotak masuk dan folder spam Anda.
          </p>
        )}
        {error && (
          <p role="alert" className="rounded-xl border border-danger bg-red-50 p-4 font-semibold text-danger">
            {AUTH_MESSAGES[error] ?? AUTH_MESSAGES.failed}
          </p>
        )}
        {googleAuthEnabled(process.env) && (
          <>
            <form action={signInWithGoogle}>
              <input type="hidden" name="returnTo" value={returnTo} />
              <Button type="submit" variant="secondary" className="w-full">{isLogin ? "Masuk dengan Google" : "Daftar dengan Google"}</Button>
            </form>
            <p className="text-center text-muted" aria-hidden="true">atau</p>
          </>
        )}
        <form action={action} className="space-y-5">
          <input type="hidden" name="returnTo" value={returnTo} />
          <label className="block">
            <span className="font-semibold">Email <span className="font-normal text-muted">(Wajib)</span></span>
            <input name="email" type="email" required autoComplete="email" className="mt-2 block min-h-12 w-full rounded-xl border border-slate-400 bg-white px-4 text-lg" />
          </label>
          <PasswordField autoComplete={isLogin ? "current-password" : "new-password"} />
          {isLogin && <Link className="inline-flex min-h-12 items-center font-semibold text-brand-dark underline" href="/forgot-password">Lupa kata sandi?</Link>}
          {!isLogin && (
            <p className="text-sm text-muted">
              Sebelum mendaftar, baca <Link className="inline-flex min-h-11 items-center font-semibold text-brand-dark underline" href="/privacy">Kebijakan Privasi</Link> dan <Link className="inline-flex min-h-11 items-center font-semibold text-brand-dark underline" href="/terms">Syarat Penggunaan</Link>.
            </p>
          )}
          <Button type="submit" className="w-full text-lg">{isLogin ? "Masuk" : "Daftar Gratis"}</Button>
        </form>
        {(error || sent || resent) && (
          <form action={resendConfirmation} className="space-y-3 border-t border-line pt-5">
            <input type="hidden" name="returnTo" value={returnTo} />
            <input type="hidden" name="page" value={mode} />
            <p className="font-semibold">Belum menerima email konfirmasi?</p>
            <label className="block">
              <span>Email untuk kirim ulang konfirmasi</span>
              <input name="email" type="email" required autoComplete="email" className="mt-2 block min-h-12 w-full rounded-xl border border-slate-400 bg-white px-4 text-lg" />
            </label>
            <Button type="submit" variant="secondary" className="w-full">Kirim ulang email konfirmasi</Button>
          </form>
        )}
      </Card>
      <p className="text-center">
        {isLogin ? (
          <>Belum punya akun? <Link className="inline-flex min-h-12 items-center font-semibold text-brand-dark underline" href="/register">Daftar Gratis</Link></>
        ) : (
          <>Sudah punya akun? <Link className="inline-flex min-h-12 items-center font-semibold text-brand-dark underline" href="/login">Masuk</Link></>
        )}
      </p>
    </main>
  );
}

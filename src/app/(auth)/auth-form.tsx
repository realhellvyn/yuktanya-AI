import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { googleAuthEnabled } from "@/lib/auth/google";
import { AUTH_MESSAGES } from "@/lib/auth/messages";
import { resendConfirmation, signInWithGoogle } from "./actions";
import { PasswordField } from "./password-field";
import { fixedText } from "@/lib/query-text";


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
      <BrandLogo href="/" className="self-start" />
      <Card className="space-y-5 !p-6 md:!p-8">
        <h1 className="text-[1.75rem] font-bold leading-tight text-navy">{isLogin ? "Masuk ke Yuktanya" : "Buat akun Yuktanya"}</h1>
        {sent && (
          <p role="status" className="rounded-xl border border-border-strong bg-tint p-4">
            Email konfirmasi sudah dikirim. Buka email tersebut, lalu tekan tautan di dalamnya. Bila belum menerima, periksa folder spam atau kirim ulang lewat formulir di bawah.
          </p>
        )}
        {resent && (
          <p role="status" className="rounded-xl border border-green-300 bg-green-50 p-4 font-semibold text-green-900">
            Email konfirmasi dikirim ulang. Periksa kotak masuk dan folder spam Anda.
          </p>
        )}
        {error && (
          <p role="alert" className="rounded-xl border border-danger bg-red-50 p-4 font-semibold text-danger">
            {fixedText(AUTH_MESSAGES, error) ?? AUTH_MESSAGES.failed}
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
            <input name="email" type="email" required autoComplete="email" className="mt-2 block min-h-12 w-full rounded-xl border border-border-strong bg-surface px-4 text-lg" />
          </label>
          <PasswordField autoComplete={isLogin ? "current-password" : "new-password"} />
          {isLogin && <Link className="inline-flex min-h-12 items-center font-semibold text-link underline" href="/forgot-password">Lupa kata sandi?</Link>}
          {!isLogin && (
            <p className="text-sm text-muted">
              Sebelum mendaftar, baca <Link className="inline-flex min-h-11 items-center font-semibold text-link underline" href="/privacy">Kebijakan Privasi</Link> dan <Link className="inline-flex min-h-11 items-center font-semibold text-link underline" href="/terms">Syarat Penggunaan</Link>.
            </p>
          )}
          <Button type="submit" className="w-full text-lg">{isLogin ? "Masuk" : "Daftar gratis"}</Button>
        </form>
        {(error || sent || resent) && (
          <form action={resendConfirmation} className="space-y-3 border-t border-line pt-5">
            <input type="hidden" name="returnTo" value={returnTo} />
            <input type="hidden" name="page" value={mode} />
            <p className="font-semibold">Belum menerima email konfirmasi?</p>
            <label className="block">
              <span>Email untuk kirim ulang konfirmasi</span>
              <input name="email" type="email" required autoComplete="email" className="mt-2 block min-h-12 w-full rounded-xl border border-border-strong bg-surface px-4 text-lg" />
            </label>
            <Button type="submit" variant="secondary" className="w-full">Kirim ulang email konfirmasi</Button>
          </form>
        )}
      </Card>
      <p className="text-center">
        {isLogin ? (
          <>Belum punya akun? <Link className="inline-flex min-h-12 items-center font-semibold text-link underline" href="/register">Daftar gratis</Link></>
        ) : (
          <>Sudah punya akun? <Link className="inline-flex min-h-12 items-center font-semibold text-link underline" href="/login">Masuk</Link></>
        )}
      </p>
    </main>
  );
}

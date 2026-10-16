import Link from "next/link";

const MESSAGES: Record<string, string> = {
  invalid: "Email atau kata sandi belum sesuai. Kata sandi minimal 8 karakter.",
  failed: "Belum berhasil. Periksa email dan kata sandi Anda, lalu coba lagi.",
  unconfigured: "Layanan masuk belum disiapkan di lingkungan ini.",
};

type Props = {
  mode: "login" | "register";
  action: (formData: FormData) => Promise<void>;
  error?: string;
  sent?: boolean;
  returnTo: string;
};

export function AuthForm({ mode, action, error, sent, returnTo }: Props) {
  const isLogin = mode === "login";
  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-3xl font-semibold">{isLogin ? "Masuk ke Yuktanya" : "Buat akun Yuktanya"}</h1>
      {sent && (
        <p role="status" className="mt-4 rounded-lg border border-slate-300 bg-white p-4">
          Kami sudah mengirim email konfirmasi. Buka email Anda lalu tekan tautannya. Belum menerima? Periksa folder spam,
          lalu daftar ulang dengan email yang sama.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-4 rounded-lg border border-red-700 bg-white p-4 text-red-800">
          {MESSAGES[error] ?? MESSAGES.failed}
        </p>
      )}
      <form action={action} className="mt-6 space-y-5">
        <input type="hidden" name="returnTo" value={returnTo} />
        <label className="block">
          <span className="font-medium">Email <span className="text-slate-600">(Wajib)</span></span>
          <input name="email" type="email" required autoComplete="email" className="mt-1 block min-h-12 w-full rounded-lg border border-slate-300 px-3" />
        </label>
        <label className="block">
          <span className="font-medium">Kata sandi <span className="text-slate-600">(Wajib, minimal 8 karakter)</span></span>
          <input name="password" type="password" required minLength={8} autoComplete={isLogin ? "current-password" : "new-password"} className="mt-1 block min-h-12 w-full rounded-lg border border-slate-300 px-3" />
        </label>
        <button type="submit" className="min-h-12 w-full rounded-lg bg-blue-600 px-4 font-semibold text-white">
          {isLogin ? "Masuk" : "Daftar Gratis"}
        </button>
      </form>
      <p className="mt-6">
        {isLogin ? (
          <>Belum punya akun? <Link className="text-blue-700 underline" href="/register">Daftar Gratis</Link></>
        ) : (
          <>Sudah punya akun? <Link className="text-blue-700 underline" href="/login">Masuk</Link></>
        )}
      </p>
    </main>
  );
}

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AUTH_MESSAGES } from "@/lib/auth/messages";
import { requestPasswordReset } from "../actions";
import { AuthShell, linkClass } from "../auth-shell";
import { fixedText } from "@/lib/query-text";

export const metadata = { title: "Lupa kata sandi | Yuktanya" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  return (
    <AuthShell title="Lupa kata sandi" footer={<Link className={linkClass} href="/login">Kembali ke halaman masuk</Link>}>
      {q.sent === "1" ? (
        <p role="status" className="rounded-xl border border-green-300 bg-green-50 p-4 text-green-900">
          <strong>Permintaan diterima.</strong> Bila email tersebut terdaftar, tautan untuk membuat kata sandi baru sudah dikirim. Periksa kotak masuk dan folder spam. Tautan hanya berlaku dalam waktu terbatas.
        </p>
      ) : (
        <>
          <p className="text-muted">Masukkan email akun Anda. Tautan untuk membuat kata sandi baru akan dikirim ke email tersebut.</p>
          {q.error && <p role="alert" className="rounded-xl border border-danger bg-red-50 p-4 font-semibold text-danger">{q.error === "invalid" ? "Format email tidak sesuai. Periksa penulisannya, misalnya nama@contoh.com." : fixedText(AUTH_MESSAGES, q.error) ?? AUTH_MESSAGES.failed}</p>}
          <form action={requestPasswordReset} className="space-y-5">
            <label className="block">
              <span className="font-semibold">Email <span className="font-normal text-muted">(Wajib)</span></span>
              <input name="email" type="email" required autoComplete="email" className="mt-2 block min-h-12 w-full rounded-xl border border-border-strong bg-surface px-4 text-lg" />
            </label>
            <Button type="submit" className="w-full text-lg">Kirim tautan atur ulang</Button>
          </form>
        </>
      )}
    </AuthShell>
  );
}

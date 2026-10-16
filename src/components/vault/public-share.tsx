import { DocumentPreview } from "@/components/documents/document-preview";
import { ACK_ERROR_MESSAGES, ACK_RESULT_MESSAGES } from "@/lib/vault/messages";
import type { ShareView } from "@/lib/vault/share";

type Action = (formData: FormData) => Promise<void>;
type Props = {
  view: ShareView;
  token: string;
  requestAction: Action;
  verifyAction: Action;
  step?: string;
  email?: string;
  result?: string;
  error?: string;
};

const NOT_OK: Record<string, string> = {
  NOT_FOUND: "Tautan tidak ditemukan.",
  EXPIRED: "Tautan sudah kedaluwarsa. Minta tautan baru kepada pemilik dokumen.",
  REVOKED: "Tautan sudah dicabut oleh pemiliknya.",
};
const box = "mt-1 block min-h-12 w-full rounded-lg border border-slate-400 px-3 text-lg";

export function PublicShare({ view, token, requestAction, verifyAction, step, email, result, error }: Props) {
  if (view.status !== "OK") {
    return (
      <main className="mx-auto max-w-3xl space-y-4 p-6">
        <h1 className="text-3xl font-semibold">Dokumen dibagikan</h1>
        <p role="status">{NOT_OK[view.status]}</p>
      </main>
    );
  }
  const resultMsg = result ? ACK_RESULT_MESSAGES[result] : undefined;
  const errorMsg = error ? ACK_ERROR_MESSAGES[error] : undefined;
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-3xl font-semibold">{view.title}</h1>
      <p>Versi {view.versionNo} · kode versi <span className="font-mono">{view.sha256.slice(0, 12)}</span> · Versi baru belum diperiksa</p>
      {view.hasNewer && <p role="status" className="rounded-lg border border-slate-300 bg-white p-3">Ada versi yang lebih baru. Minta tautan baru kepada pemilik dokumen.</p>}
      <DocumentPreview doc={view.doc} />

      <section aria-labelledby="ack-h" className="space-y-3 rounded-lg border border-slate-300 bg-white p-4">
        <h2 id="ack-h" className="text-xl font-semibold">Konfirmasi baca (opsional)</h2>
        <p>Konfirmasi baca hanya menyatakan Anda sudah membaca versi ini. Ini bukan tanda tangan elektronik.</p>
        {resultMsg && <p role="status" className="font-semibold">{resultMsg}</p>}
        {errorMsg && <p role="alert" className="font-semibold text-red-800">{errorMsg}</p>}
        {step === "kode" ? (
          <form action={verifyAction} className="space-y-3">
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="email" value={email ?? ""} />
            <label className="block">
              <span className="font-medium">Kode 6 digit dari email Anda (Wajib)</span>
              <input name="code" inputMode="numeric" pattern="\d{6}" maxLength={6} required autoComplete="one-time-code" className={box} />
            </label>
            <button type="submit" className="min-h-12 rounded-lg bg-blue-600 px-5 font-semibold text-white">Konfirmasi</button>
          </form>
        ) : (
          <form action={requestAction} className="space-y-3">
            <input type="hidden" name="token" value={token} />
            <label className="block">
              <span className="font-medium">Email Anda (Wajib)</span>
              <input name="email" type="email" required autoComplete="email" className={box} />
            </label>
            <button type="submit" className="min-h-12 rounded-lg bg-blue-600 px-5 font-semibold text-white">Kirim kode</button>
          </form>
        )}
      </section>

      <a href="/register" className="inline-flex min-h-12 items-center rounded-lg border border-slate-400 bg-white px-5 font-medium">Buat dokumen sendiri, gratis</a>
    </main>
  );
}

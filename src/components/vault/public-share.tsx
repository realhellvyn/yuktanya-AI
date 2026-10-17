import { DocumentPreview } from "@/components/documents/document-preview";
import { ACK_ERROR_MESSAGES, ACK_RESULT_MESSAGES } from "@/lib/vault/messages";
import type { ShareView } from "@/lib/vault/share";
import { fixedText, maskEmail } from "@/lib/query-text";

type Action = (formData: FormData) => Promise<void>;
type Props = {
  view: ShareView;
  token: string;
  requestAction: Action;
  verifyAction: Action;
  // false = layanan email belum aktif: tidak ada formulir dan tidak ada janji kode terkirim.
  ackAvailable: boolean;
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
const box = "mt-1 block min-h-12 w-full rounded-lg border border-border-strong px-3 text-lg";

export function PublicShare({ view, token, requestAction, verifyAction, ackAvailable, step, email, result, error }: Props) {
  if (view.status !== "OK") {
    return (
      <main className="mx-auto max-w-3xl space-y-4 p-6">
        <h1 className="text-3xl font-semibold">Dokumen dibagikan</h1>
        <p role="status">{NOT_OK[view.status]}</p>
      </main>
    );
  }
  // Email dari alamat (?e=) hanya dipakai bila berbentuk email dan ditampilkan tersamar (teks bebas tidak pernah tampil).
  const shownEmail = maskEmail(email);
  const safeEmail = shownEmail ? email!.trim() : "";
  const resultMsg = result ? fixedText(ACK_RESULT_MESSAGES, result) : undefined;
  const errorMsg = error ? fixedText(ACK_ERROR_MESSAGES, error) : undefined;
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-3xl font-semibold">{view.title}</h1>
      <p>Versi {view.versionNo} · kode versi <span className="font-mono">{view.sha256.slice(0, 12)}</span> · Versi baru belum diperiksa</p>
      {view.hasNewer && <p role="status" className="rounded-lg border border-line bg-surface p-3">Ada versi yang lebih baru. Minta tautan baru kepada pemilik dokumen.</p>}
      <DocumentPreview doc={view.doc} />

      <section aria-labelledby="ack-h" className="space-y-3 rounded-lg border border-line bg-surface p-4">
        <h2 id="ack-h" className="text-xl font-semibold">Konfirmasi baca (opsional)</h2>
        <p>Konfirmasi baca hanya menyatakan Anda sudah membaca versi ini. Ini bukan tanda tangan elektronik.</p>
        {!ackAvailable ? (
          <p role="status" className="rounded-lg border border-line bg-subtle p-3">{ACK_ERROR_MESSAGES.unavailable} Anda tetap dapat membaca dokumen ini.</p>
        ) : <>
        {resultMsg && <p role="status" className="font-semibold">{resultMsg}</p>}
        {errorMsg && <p role="alert" className="font-semibold text-danger">{errorMsg}</p>}
        {step === "kode" ? (
          <div className="space-y-4">
            {shownEmail && <p>Kode dikirim ke {shownEmail}</p>}
            <form action={verifyAction} className="space-y-3">
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="email" value={safeEmail} />
              <label className="block">
                <span className="font-medium">Kode 6 digit dari email Anda (Wajib)</span>
                <input name="code" inputMode="numeric" pattern="\d{6}" maxLength={6} required autoComplete="one-time-code" className={box} />
              </label>
              <button type="submit" className="min-h-12 rounded-lg bg-primary hover:bg-primary-hover px-5 font-semibold text-on-primary">Konfirmasi</button>
            </form>
            <div className="flex flex-wrap gap-3">
              <form action={requestAction}>
                <input type="hidden" name="token" value={token} />
                <input type="hidden" name="email" value={safeEmail} />
                <button type="submit" className="min-h-12 rounded-lg border border-border-strong bg-surface px-5 font-medium">Kirim ulang kode</button>
              </form>
              <a href={`/s/${encodeURIComponent(token)}`} className="inline-flex min-h-12 items-center rounded-lg border border-border-strong bg-surface px-5 font-medium">Ubah email</a>
            </div>
          </div>
        ) : (
          <form action={requestAction} className="space-y-3">
            <input type="hidden" name="token" value={token} />
            <label className="block">
              <span className="font-medium">Email Anda (Wajib)</span>
              <input name="email" type="email" required autoComplete="email" className={box} />
            </label>
            <button type="submit" className="min-h-12 rounded-lg bg-primary hover:bg-primary-hover px-5 font-semibold text-on-primary">Kirim kode</button>
          </form>
        )}
        </>}
      </section>

      <a href="/register" className="inline-flex min-h-12 items-center rounded-lg border border-border-strong bg-surface px-5 font-medium">Buat dokumen sendiri, gratis</a>
    </main>
  );
}

import { formatDateId } from "@/lib/documents/format";
import { PANEL_NOTICES } from "@/lib/vault/messages";
import type { AckRow, ShareRow } from "@/lib/vault/share";
import type { ReminderOption } from "@/lib/vault/reminders";
import { CreateShareForm, type CreateShareState } from "./create-share-form";

type Action = (formData: FormData) => Promise<void>;
type Props = {
  documentId: string;
  versionId: string;
  features: { share: boolean; reminders: boolean; evidence: boolean };
  shares: ShareRow[];
  acks: AckRow[];
  reminderOptions: ReminderOption[];
  packId?: string;
  notice?: string;
  // false = layanan email belum aktif: konfirmasi baca dan pengingat lewat email tidak dijanjikan.
  emailAvailable: boolean;
  actions: {
    createShare: (prev: CreateShareState, formData: FormData) => Promise<CreateShareState>;
    revokeShare: Action;
    setReminder: Action;
    cancelReminder: Action;
    buildPack: Action;
  };
};

const when = (iso: string) => new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(iso));
const btn = "min-h-12 rounded-lg border border-slate-400 bg-white px-5 font-medium";
const primary = "min-h-12 rounded-lg bg-brand hover:bg-brand-dark px-5 font-semibold text-white";

const Locked = () => <p className="rounded-lg border border-line bg-slate-50 p-3">Tersedia untuk Member</p>;

function shareStatus(s: ShareRow): string {
  if (s.revokedAt) return "Dicabut";
  return new Date(s.expiresAt).getTime() <= Date.now() ? "Kedaluwarsa" : "Aktif";
}

export function VaultPanel({ documentId, versionId, features, shares, acks, reminderOptions, packId, notice, emailAvailable, actions }: Props) {
  return (
    <div className="space-y-8">
      {notice && PANEL_NOTICES[notice] && <p role="alert" className="rounded-lg border border-red-700 bg-white p-4 text-danger">{PANEL_NOTICES[notice]}</p>}

      <section aria-labelledby="share-h" className="space-y-3">
        <h2 id="share-h" className="text-2xl font-semibold">Bagikan ke pihak lawan</h2>
        {!features.share ? <Locked /> : (
          <>
            <p>Siapa pun yang punya link dapat membaca dokumen ini. Bagikan hanya kepada pihak yang Anda percaya. Anda dapat mencabut link kapan saja.</p>
            {emailAvailable
              ? <p>Pihak lawan dapat menekan konfirmasi baca lewat email. Konfirmasi baca hanya menyatakan seseorang sudah membaca versi ini dan bukan tanda tangan elektronik.</p>
              : <p>Konfirmasi baca lewat email belum tersedia karena layanan email belum aktif. Pihak lawan tetap dapat membaca dokumen lewat link. (Konfirmasi baca nantinya hanya menyatakan seseorang sudah membaca versi ini dan bukan tanda tangan elektronik.)</p>}
            <CreateShareForm action={actions.createShare} versionId={versionId} documentId={documentId} />
            {shares.length > 0 && (
              <ul className="space-y-2">
                {shares.map((s) => (
                  <li key={s.id} className="rounded-lg border border-line bg-white p-3">
                    <p>Dibuat {when(s.createdAt)} WIB · berlaku sampai {when(s.expiresAt)} WIB · {shareStatus(s)} · Dibuka {s.openedCount} kali</p>
                    {!s.revokedAt && (
                      <form action={actions.revokeShare}>
                        <input type="hidden" name="shareId" value={s.id} />
                        <input type="hidden" name="documentId" value={documentId} />
                        <input type="hidden" name="versionId" value={versionId} />
                        <button type="submit" className={btn}>Cabut tautan</button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {acks.length > 0 && (
              <div>
                <h3 className="font-semibold">Konfirmasi baca</h3>
                <ul>{acks.map((a) => <li key={`${a.shareId}-${a.email}`}>{a.email} · {when(a.verifiedAt)} WIB</li>)}</ul>
              </div>
            )}
          </>
        )}
      </section>

      <section aria-labelledby="rem-h" className="space-y-3">
        <h2 id="rem-h" className="text-2xl font-semibold">Pengingat tenggat</h2>
        {features.reminders && !emailAvailable && <p role="status" className="rounded-lg border border-line bg-slate-50 p-3">Pengingat lewat email belum dapat dikirim karena layanan email belum aktif. Pengingat yang Anda atur tersimpan, tetapi belum ada email yang terkirim.</p>}
        {!features.reminders ? <Locked /> : reminderOptions.length === 0 ? <p>Dokumen ini tidak punya tenggat yang bisa diingatkan.</p> : (
          reminderOptions.map((o) => (
            <form key={o.specId} action={actions.setReminder} className="space-y-2 rounded-lg border border-line bg-white p-3">
              <input type="hidden" name="documentId" value={documentId} />
              <input type="hidden" name="versionId" value={versionId} />
              <input type="hidden" name="specId" value={o.specId} />
              <p className="font-semibold">{o.label}: {formatDateId(o.dueDate)}</p>
              <fieldset className="flex flex-wrap gap-4">
                <legend className="mb-1">Ingatkan lewat email:</legend>
                {[30, 7, 1].map((d) => (
                  <label key={d} className="flex min-h-12 items-center gap-2">
                    <input type="checkbox" name="offset" value={String(d)} defaultChecked /> {d} hari sebelumnya
                  </label>
                ))}
              </fieldset>
              <div className="flex flex-wrap gap-3">
                <button type="submit" className={primary}>Atur pengingat</button>
                <button type="submit" formAction={actions.cancelReminder} className={btn}>Batalkan pengingat</button>
              </div>
            </form>
          ))
        )}
      </section>

      <section aria-labelledby="pack-h" className="space-y-3">
        <h2 id="pack-h" className="text-2xl font-semibold">Paket bukti</h2>
        {!features.evidence ? <Locked /> : (
          <>
            <p>Paket bukti berisi riwayat versi, kode hash, ekspor, dan konfirmasi baca. Paket ini adalah kumpulan catatan sistem, bukan jaminan nilai pembuktian di pengadilan.</p>
            <form action={actions.buildPack}>
              <input type="hidden" name="documentId" value={documentId} />
              <input type="hidden" name="versionId" value={versionId} />
              <button type="submit" className={primary}>Buat paket bukti</button>
            </form>
            {packId && <a className="inline-flex min-h-12 items-center text-brand-dark underline" href={`/api/documents/evidence/${packId}`}>Paket siap. Tekan di sini untuk mengunduh.</a>}
          </>
        )}
      </section>
    </div>
  );
}

import Link from "next/link";
import { Card, PageHeading } from "@/components/ui/card";
import { getPool } from "@/lib/db";
import { requireUserId } from "@/lib/documents/session";
import { CONFIRM_WORD, ERASE_BLOCK_MESSAGES, erasureBlockers } from "@/lib/retention/erasure";
import { deleteAccountAction } from "../actions";
import { fixedText } from "@/lib/query-text";

export const dynamic = "force-dynamic";
export const metadata = { title: "Hapus Akun | Yuktanya" };

const link = "inline-flex min-h-12 items-center font-semibold text-link underline";
const ERRORS: Record<string, string> = {
  confirm: `Ketik kata ${CONFIRM_WORD} persis seperti contoh untuk melanjutkan. Akun Anda belum dihapus.`,
  blocked: "Akun belum bisa dihapus. Lihat alasannya di bawah. Tidak ada data yang berubah.",
  error: "Penghapusan gagal karena gangguan sistem. Tidak ada data yang berubah. Coba lagi nanti.",
};

export default async function DeleteAccountPage({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  // Sesi dan peran diperiksa ulang di server; alasan penolakan dihitung dari DB, bukan dari parameter.
  const userId = await requireUserId();
  const { e } = await searchParams;
  const blockers = await erasureBlockers(getPool(), userId);
  const error = fixedText(ERRORS, e);

  return (
    <main className="max-w-3xl space-y-6">
      <PageHeading title="Hapus akun" lead="Baca dulu apa yang dihapus dan apa yang tetap disimpan. Penghapusan tidak dapat dibatalkan." />
      {error && <p role="alert" className="rounded-xl border border-danger bg-red-50 p-4 font-semibold text-danger">{error}</p>}

      <section aria-labelledby="dihapus">
        <Card className="space-y-3">
          <h2 id="dihapus" className="text-xl font-bold text-navy">Yang akan dihapus</h2>
          <ul className="list-disc space-y-1.5 pl-6">
            <li>Semua dokumen Anda beserta setiap versinya, draf, dan percakapan dengan AI.</li>
            <li>Berkas yang Anda unggah, berkas unduhan dokumen, dan paket bukti.</li>
            <li>Tautan bagikan, catatan konfirmasi baca dari penerima, dan pengingat.</li>
            <li>Ringkasan yang Anda tulis untuk Kasus Hukum Khusus, dan nama profil Anda.</li>
            <li>Login Anda. Setelah ini Anda tidak bisa masuk lagi dengan email ini ke akun yang sama.</li>
          </ul>
        </Card>
      </section>

      <section aria-labelledby="disimpan">
        <Card className="space-y-3">
          <h2 id="disimpan" className="text-xl font-bold text-navy">Yang tetap disimpan, dan alasannya</h2>
          <ul className="list-disc space-y-1.5 pl-6">
            <li>Catatan pesanan dan pembayaran: dibutuhkan untuk pencocokan keuangan. Catatan ini tidak lagi terhubung dengan email Anda.</li>
            <li>Catatan audit sistem (tanpa isi dokumen): agar riwayat tindakan penting tetap dapat dipercaya.</li>
            <li>Dokumen yang sudah diperiksa pengacara atau punya kode verifikasi: kode verifikasinya tetap bisa dicek orang lain di halaman Cek Keaslian (hanya status dan sidik jari), tetapi judul dan isi dokumennya dikosongkan. Laporan pemeriksaan pengacara tetap disimpan sebagai catatan kerja mereka.</li>
          </ul>
          <p className="text-muted">Aturan ini adalah pengaturan awal sistem dan menunggu persetujuan mitra hukum.</p>
          <p>Ingin menyimpan salinan? <a className={link} href="/settings/export">Unduh data saya dulu</a></p>
        </Card>
      </section>

      {blockers.length > 0 ? (
        <section aria-labelledby="tertahan">
          <Card className="space-y-3 border-amber-400 bg-amber-50">
            <h2 id="tertahan" className="text-xl font-bold text-navy">Akun belum bisa dihapus sekarang</h2>
            <ul className="list-disc space-y-1.5 pl-6" data-testid="erase-blockers">
              {blockers.map((b) => <li key={b}>{ERASE_BLOCK_MESSAGES[b] ?? "Masih ada proses yang berjalan. Coba lagi nanti."}</li>)}
            </ul>
            <Link className={link} href="/settings">Kembali ke Pengaturan</Link>
          </Card>
        </section>
      ) : (
        <section aria-labelledby="konfirmasi">
          <Card className="space-y-4 border-danger">
            <h2 id="konfirmasi" className="text-xl font-bold text-navy">Konfirmasi penghapusan</h2>
            <form action={deleteAccountAction} className="space-y-4">
              <label className="block">
                <span className="font-semibold">Ketik <strong>{CONFIRM_WORD}</strong> untuk mengonfirmasi</span>
                <input
                  name="confirm"
                  required
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  className="mt-2 block min-h-12 w-full rounded-xl border border-border-strong bg-surface px-4 text-lg"
                />
              </label>
              <button type="submit" className="min-h-[52px] w-full rounded-xl bg-danger px-6 text-lg font-semibold text-white hover:opacity-90">
                Hapus akun saya selamanya
              </button>
            </form>
            <Link className={link} href="/settings">Batal, kembali ke Pengaturan</Link>
          </Card>
        </section>
      )}
    </main>
  );
}

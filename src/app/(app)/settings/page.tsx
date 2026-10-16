import Link from "next/link";
import { Card, PageHeading } from "@/components/ui/card";
import { buttonClass } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { createPgUsageStore } from "@/lib/ai/quota";
import { getMembershipState } from "@/lib/billing/membership";
import { getPool } from "@/lib/db";
import { formatDateId, wibDate } from "@/lib/documents/format";
import { requireUserId } from "@/lib/documents/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pengaturan | Yuktanya" };

const link = "inline-flex min-h-12 items-center font-semibold text-brand-dark underline";

const NOTICES: Record<string, string> = {
  "export-limit": "Anda sudah mengunduh data beberapa kali dalam satu jam terakhir. Coba lagi nanti.",
  "export-large": "Data Anda terlalu besar untuk diunduh sekaligus. Hubungi tim Yuktanya lewat halaman Bantuan.",
};

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  // Sesi dan peran diperiksa ulang di server; email hanya dari sesi, bukan dari parameter.
  const userId = await requireUserId();
  const notice = NOTICES[(await searchParams).notice ?? ""];
  const { data } = await (await createSupabaseServerClient()).auth.getUser();
  const pool = getPool();
  const [usage, member] = await Promise.all([createPgUsageStore(pool).snapshot(userId), getMembershipState(pool, userId)]);
  return (
    <main className="max-w-3xl space-y-6">
      <PageHeading title="Pengaturan" lead="Data akun dan privasi Anda." />
      {notice && <p role="alert" data-testid="settings-notice" className="rounded-xl border border-amber-400 bg-amber-50 p-4 font-semibold">{notice}</p>}

      <section aria-labelledby="akun">
        <Card className="space-y-4">
          <h2 id="akun" className="text-xl font-bold text-navy">Akun</h2>
          <dl className="space-y-3">
            <div><dt className="text-muted">Email</dt><dd className="break-all text-lg font-semibold" data-testid="account-email">{data.user?.email ?? "-"}</dd></div>
            <div>
              <dt className="text-muted">Paket</dt>
              <dd className="flex flex-wrap items-center gap-3 text-lg font-semibold">
                {member.active ? "Member Aktif" : "Gratis"}
                <StatusBadge tone={member.active ? "success" : "neutral"}>{member.active ? "Aktif" : "Tanpa membership"}</StatusBadge>
              </dd>
              {member.active && <dd className="text-muted">Periode: {formatDateId(wibDate(member.periodStart))} – {formatDateId(wibDate(member.periodEnd))}</dd>}
            </div>
            <div>
              <dt className="text-muted">Sisa hari ini (di-reset pukul 00.00 WIB)</dt>
              <dd>
                <ul className="list-disc space-y-1 pl-6">
                  <li>Pesan AI: {usage.messagesRemaining} dari {usage.messageLimit}</li>
                  <li>Dokumen baru: {usage.documentsRemaining} dari {usage.documentLimit}</li>
                  <li>Analisis awal AI: {usage.aiReviewsRemaining} dari {usage.aiReviewLimit}</li>
                </ul>
              </dd>
            </div>
          </dl>
          <div className="flex flex-wrap gap-x-6">
            <Link className={link} href="/membership">Lihat membership</Link>
            <Link className={link} href="/forgot-password">Ganti kata sandi</Link>
          </div>
        </Card>
      </section>

      <section aria-labelledby="privasi">
        <Card className="space-y-3">
          <h2 id="privasi" className="text-xl font-bold text-navy">Privasi</h2>
          <p>Baca apa yang disimpan Yuktanya dan ke mana data dikirim.</p>
          <div className="flex flex-wrap gap-x-6">
            <Link className={link} href="/privacy">Kebijakan Privasi</Link>
            <Link className={link} href="/terms">Syarat Penggunaan</Link>
          </div>
        </Card>
      </section>

      <section aria-labelledby="data-anda">
        <Card className="space-y-4">
          <h2 id="data-anda" className="text-xl font-bold text-navy">Data Anda</h2>
          <div className="space-y-2">
            <p>Unduh salinan data Anda dalam satu berkas (JSON): profil, dokumen dan isinya, percakapan, unggahan, pesanan, dan Kasus Hukum Khusus.</p>
            <a className={buttonClass("secondary")} href="/settings/export" data-testid="export-link">Unduh data saya</a>
          </div>
          <div className="space-y-2 border-t border-line pt-4">
            <p>Hapus akun beserta dokumen dan percakapan Anda. Sebelum menghapus, Anda akan melihat apa yang dihapus dan apa yang tetap disimpan.</p>
            <Link className={link} href="/settings/hapus-akun">Hapus akun</Link>
          </div>
        </Card>
      </section>
    </main>
  );
}

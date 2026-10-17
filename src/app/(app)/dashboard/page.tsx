import { createPgUsageStore } from "@/lib/ai/quota";
import { getMembershipState } from "@/lib/billing/membership";
import { AI_DRAFT_LABEL } from "@/lib/copy";
import { getPool } from "@/lib/db";
import { formatDateId, wibDate } from "@/lib/documents/format";
import { documentsService } from "@/lib/documents/runtime";
import { requireUserId } from "@/lib/documents/session";
import { formatIdr, PRICING } from "@/lib/pricing/catalog";
import { flags } from "@/lib/flags";
import { reviewService } from "@/lib/reviews/runtime";
import { ButtonLink } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";

export const dynamic = "force-dynamic";
export const metadata = { title: "Beranda | Yuktanya" };

const REVIEW_STATUS: Record<string, { text: string; tone: "info" | "success" | "warning" | "neutral" }> = {
  QUEUED: { text: "Menunggu pemeriksaan", tone: "warning" },
  ASSIGNED: { text: "Menunggu pemeriksaan", tone: "warning" },
  IN_REVIEW: { text: "Sedang diperiksa", tone: "info" },
  COMPLETED: { text: "Selesai diperiksa", tone: "success" },
  DECLINED: { text: "Tidak dapat diperiksa", tone: "neutral" },
  CANCELLED: { text: "Dibatalkan", tone: "neutral" },
};

// Waktu reset dari backend (resetAt), ditampilkan dalam WIB.
const resetText = (iso: string) =>
  `pukul ${new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Jakarta" }).format(new Date(iso)).replace(":", ".")} WIB`;

function Quota({ label, left, total }: { label: string; left: number; total: number }) {
  const pct = total > 0 ? Math.round((left / total) * 100) : 0;
  return (
    <li className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium">{label}</span>
        <span className="whitespace-nowrap font-semibold text-navy">{left} dari {total}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-line" aria-hidden="true"><div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} /></div>
    </li>
  );
}

export default async function DashboardPage() {
  const userId = await requireUserId();
  const pool = getPool();
  const [docs, reviews, usage, membership] = await Promise.all([
    documentsService().list(userId),
    reviewService().listForOwner(userId),
    createPgUsageStore(pool).snapshot(userId),
    getMembershipState(pool, userId),
  ]);
  const draft = docs.find((d) => d.versionCount === 0);
  const recent = docs.slice(0, 3);

  return (
    <main className="max-w-4xl space-y-8">
      <header className="space-y-2">
        <h1 className="text-[1.75rem] font-bold leading-tight tracking-tight text-navy md:text-4xl">Selamat datang di Yuktanya</h1>
        <p className="text-xl text-muted">Apa yang ingin Anda buat hari ini?</p>
      </header>

      <Card className="space-y-4 border-line bg-tint">
        {draft ? (
          <>
            <p className="text-lg font-semibold text-navy">Lanjutkan dokumen terakhir: {draft.title}</p>
            <div className="flex flex-wrap gap-3">
              <ButtonLink href={`/workspace/${draft.id}`}>Lanjutkan mengisi</ButtonLink>
              <ButtonLink href="/workspace/new" variant="secondary">Buat dokumen baru</ButtonLink>
            </div>
          </>
        ) : (
          <>
            <p className="text-lg font-semibold text-navy">Buat dokumen dengan bantuan AI. Gratis.</p>
            <p className="text-muted">Pilih jenis dokumen, lalu ceritakan isinya kepada AI. Belum tahu dokumen mana yang cocok? Pilih &ldquo;Saya belum tahu&rdquo;.</p>
            <div><ButtonLink href="/workspace/new">Buat dokumen baru (Gratis)</ButtonLink></div>
          </>
        )}
        <p className="text-muted">{AI_DRAFT_LABEL} AI bukan pengacara.</p>
        <div className="border-t border-line pt-4">
          {flags.aiPreReview
            ? <ButtonLink href="/documents/upload" variant="secondary">Periksa dokumen yang sudah Anda punya</ButtonLink>
            : <ButtonLink href="/bantuan#pengacara" variant="secondary">Cara memeriksakan dokumen ke pengacara</ButtonLink>}
        </div>
      </Card>

      <section aria-labelledby="doc-h" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="doc-h" className="text-2xl font-bold text-navy">Dokumen Saya</h2>
          {docs.length > 0 && <ButtonLink href="/documents" variant="quiet">Lihat semua</ButtonLink>}
        </div>
        {recent.length === 0 ? (
          <EmptyState title="Belum ada dokumen" text="Mulai dari membuat dokumen pertama Anda." action={<ButtonLink href="/workspace/new">Buat Dokumen</ButtonLink>} />
        ) : (
          <ul className="space-y-3">
            {recent.map((d) => (
              <li key={d.id}>
                <Card className="flex flex-wrap items-center justify-between gap-3 !p-4">
                  <div className="min-w-0">
                    <p className="font-semibold text-navy">{d.title}</p>
                    <p className="text-sm text-muted">Dibuat {formatDateId(wibDate(d.createdAt))}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {d.versionCount === 0 ? <StatusBadge tone="warning">Draf belum selesai</StatusBadge> : <StatusBadge tone="info">Dokumen sudah dibuat</StatusBadge>}
                    <ButtonLink href={d.versionCount === 0 ? `/workspace/${d.id}` : `/documents/${d.id}`} variant="secondary">{d.versionCount === 0 ? "Lanjutkan" : "Buka"}</ButtonLink>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      {reviews.length > 0 && (
        <section aria-labelledby="rev-h" className="space-y-3">
          <h2 id="rev-h" className="text-2xl font-bold text-navy">Status Pemeriksaan</h2>
          <ul className="space-y-3">
            {reviews.slice(0, 3).map((r) => {
              const s = REVIEW_STATUS[r.status] ?? { text: r.status, tone: "neutral" as const };
              return (
                <li key={r.requestId}>
                  <Card className="flex flex-wrap items-center justify-between gap-3 !p-4">
                    <p className="font-semibold text-navy">{r.title} — versi {r.versionNo}</p>
                    <div className="flex items-center gap-3">
                      <StatusBadge tone={s.tone}>{s.text}</StatusBadge>
                      <ButtonLink href={`/reviews/${r.requestId}`} variant="secondary">Lihat</ButtonLink>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="space-y-4">
          <h2 className="text-xl font-bold text-navy">Pemakaian hari ini</h2>
          <ul className="space-y-4">
            <Quota label="Sisa pesan AI" left={usage.messagesRemaining} total={usage.messageLimit} />
            <Quota label="Sisa pembuatan dokumen" left={usage.documentsRemaining} total={usage.documentLimit} />
            <Quota label="Sisa pemeriksaan awal AI" left={usage.aiReviewsRemaining} total={usage.aiReviewLimit} />
          </ul>
          <p className="text-sm text-muted">Setiap pemeriksaan AI memakai 1 pesan AI. Jatah dihitung ulang {resetText(usage.resetAt)}.</p>
        </Card>
        <Card className="space-y-3">
          {membership.active ? (
            <>
              <div className="flex flex-wrap items-center gap-3"><h2 className="text-xl font-bold text-navy">Member Aktif</h2><StatusBadge tone="success">Aktif</StatusBadge></div>
              <p>Periode: {formatDateId(wibDate(membership.periodStart))} – {formatDateId(wibDate(membership.periodEnd))}</p>
              <p className="font-semibold">{membership.firstReviewUsed ? `Pemeriksaan berikutnya: ${formatIdr(PRICING.standard.memberLater)}` : `Pemeriksaan pertama: ${formatIdr(PRICING.standard.memberFirst)}`}</p>
              <p className="text-sm text-muted">Membership {formatIdr(PRICING.membershipMonthlyIdr)} per periode tagihan.</p>
            </>
          ) : (
            <>
              <h2 className="text-xl font-bold text-navy">Akun Gratis</h2>
              <p>Buat dokumen dengan AI: <strong>Gratis</strong></p>
              <p>Pemeriksaan pengacara: <strong>{formatIdr(PRICING.standard.free)}</strong> per dokumen standar</p>
              <ButtonLink href="/membership" variant="quiet">Lihat membership (opsional)</ButtonLink>
            </>
          )}
        </Card>
      </div>

      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-bold text-navy">Butuh bantuan?</h2>
          <p className="text-muted">Cara membuat dokumen, batas harian, pemeriksaan pengacara, dan cara mengecek keaslian dokumen.</p>
        </div>
        <ButtonLink href="/bantuan" variant="secondary">Buka Bantuan</ButtonLink>
      </Card>
    </main>
  );
}

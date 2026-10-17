import { ButtonLink } from "@/components/ui/button";
import { Card, EmptyState, PageHeading } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireUserId } from "@/lib/documents/session";
import { reviewService } from "@/lib/reviews/runtime";

export const metadata = { title: "Legal Review Saya | Yuktanya" };

export const dynamic = "force-dynamic";
const STATUS: Record<string, { text: string; tone: "info" | "success" | "warning" | "neutral" }> = {
  QUEUED: { text: "Menunggu diperiksa", tone: "warning" }, ASSIGNED: { text: "Menunggu diperiksa", tone: "warning" },
  IN_REVIEW: { text: "Sedang diperiksa", tone: "info" }, COMPLETED: { text: "Selesai diperiksa", tone: "success" },
  DECLINED: { text: "Tidak dapat diperiksa", tone: "neutral" }, CANCELLED: { text: "Dibatalkan", tone: "neutral" },
};

export default async function ReviewsPage({ searchParams }: { searchParams: Promise<{ notice?: string; dibuat?: string }> }) {
  const q = await searchParams;
  const userId = await requireUserId();
  const rows = await reviewService().listForOwner(userId);
  return (
    <main className="max-w-3xl space-y-6">
      <PageHeading title="Legal Review Saya" lead="Status Legal Review dokumen Anda oleh pengacara mitra." />
      {q.dibuat && <p role="status" className="rounded-xl border border-green-300 bg-green-50 p-4 font-semibold text-success">✓ Pengajuan Legal Review diterima dan masuk antrean.</p>}
      {q.notice === "deep-tidak-valid" && <p role="alert" className="font-semibold text-red-800">Deep Review belum dapat dipesan karena Legal Review terkait tidak ditemukan. Buka hasil Legal Review dari daftar di bawah, lalu coba lagi.</p>}
      {q.notice === "sudah" && <p role="status" className="rounded-xl border border-line bg-surface p-4">Versi ini sudah memiliki pengajuan Legal Review. Statusnya tampil di daftar di bawah.</p>}
      {rows.length === 0 ? (
        <EmptyState title="Belum ada Legal Review" text="Buka salah satu dokumen Anda, lalu tekan “Ajukan Legal Review”." action={<div className="flex flex-wrap gap-3"><ButtonLink href="/bantuan#pengacara" variant="secondary">Lihat cara mengajukan</ButtonLink><ButtonLink href="/documents" variant="quiet">Buka Dokumen Saya</ButtonLink></div>} />
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => {
            const st = STATUS[r.status] ?? { text: r.status, tone: "neutral" as const };
            return (
              <li key={r.requestId}>
                <Card className="flex flex-wrap items-center justify-between gap-3 !p-4">
                  <div className="space-y-1.5"><p className="text-lg font-bold text-navy">{r.title}, versi {r.versionNo}</p><StatusBadge tone={st.tone}>{st.text}</StatusBadge></div>
                  <ButtonLink href={`/reviews/${r.requestId}`} variant="secondary">Lihat hasil</ButtonLink>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

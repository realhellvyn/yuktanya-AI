import { ButtonLink } from "@/components/ui/button";
import { Card, EmptyState, PageHeading } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { requireUserId } from "@/lib/documents/session";
import { reviewService } from "@/lib/reviews/runtime";

export const dynamic = "force-dynamic";
const STATUS: Record<string, { text: string; tone: "info" | "success" | "warning" | "neutral" }> = {
  QUEUED: { text: "Menunggu pemeriksaan", tone: "warning" }, ASSIGNED: { text: "Menunggu pemeriksaan", tone: "warning" },
  IN_REVIEW: { text: "Sedang diperiksa", tone: "info" }, COMPLETED: { text: "Selesai diperiksa", tone: "success" },
  DECLINED: { text: "Tidak dapat diperiksa", tone: "neutral" }, CANCELLED: { text: "Dibatalkan", tone: "neutral" },
};

export default async function ReviewsPage({ searchParams }: { searchParams: Promise<{ notice?: string; dibuat?: string }> }) {
  const q = await searchParams;
  const userId = await requireUserId();
  const rows = await reviewService().listForOwner(userId);
  return (
    <main className="max-w-3xl space-y-6">
      <PageHeading title="Review Saya" lead="Status pemeriksaan dokumen Anda oleh pengacara." />
      {q.dibuat && <p role="status" className="rounded-xl border border-green-300 bg-green-50 p-4 font-semibold text-success">✓ Permintaan pemeriksaan diterima dan masuk antrean.</p>}
      {q.notice === "deep-tidak-valid" && <p role="alert" className="font-semibold text-red-800">Pemeriksaan mendalam tidak dapat dipesan karena pemeriksaan standar tidak dikenali.</p>}
      {q.notice === "sudah" && <p role="status" className="rounded-xl border border-line bg-white p-4">Versi ini sudah punya permintaan pemeriksaan.</p>}
      {rows.length === 0 ? (
        <EmptyState title="Belum ada dokumen yang diperiksa pengacara" text="Buka salah satu dokumen Anda lalu pilih “Minta pemeriksaan pengacara”." action={<ButtonLink href="/documents" variant="secondary">Lihat dokumen saya</ButtonLink>} />
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => {
            const st = STATUS[r.status] ?? { text: r.status, tone: "neutral" as const };
            return (
              <li key={r.requestId}>
                <Card className="flex flex-wrap items-center justify-between gap-3 !p-4">
                  <div className="space-y-1.5"><p className="text-lg font-bold text-navy">{r.title} — versi {r.versionNo}</p><StatusBadge tone={st.tone}>{st.text}</StatusBadge></div>
                  <ButtonLink href={`/reviews/${r.requestId}`} variant="secondary">Lihat</ButtonLink>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

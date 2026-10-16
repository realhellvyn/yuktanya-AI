import Link from "next/link";
import { requireUserId } from "@/lib/documents/session";
import { reviewService } from "@/lib/reviews/runtime";

export const dynamic = "force-dynamic";
const STATUS: Record<string, string> = { QUEUED: "Dalam antrean", ASSIGNED: "Dalam antrean", IN_REVIEW: "Sedang diperiksa", COMPLETED: "Selesai", DECLINED: "Tidak dapat diperiksa", CANCELLED: "Dibatalkan" };

export default async function ReviewsPage({ searchParams }: { searchParams: Promise<{ notice?: string; dibuat?: string }> }) {
  const q = await searchParams;
  const userId = await requireUserId();
  const rows = await reviewService().listForOwner(userId);
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-3xl font-semibold">Review Saya</h1>
      {q.dibuat && <p role="status" className="rounded-lg border border-slate-300 bg-white p-4">Permintaan pemeriksaan diterima dan masuk antrean.</p>}
      {q.notice === "sudah" && <p role="status" className="rounded-lg border border-slate-300 bg-white p-4">Versi ini sudah punya permintaan pemeriksaan.</p>}
      {rows.length === 0 ? (
        <p>Belum ada pemeriksaan. Buka salah satu dokumen Anda lalu pilih “Minta pemeriksaan pengacara”.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.requestId} className="rounded-lg border border-slate-300 bg-white p-4">
              <Link className="inline-flex min-h-12 items-center text-lg font-semibold underline" href={`/reviews/${r.requestId}`}>{r.title} — versi {r.versionNo}</Link>
              <p>Status: {STATUS[r.status] ?? r.status}</p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

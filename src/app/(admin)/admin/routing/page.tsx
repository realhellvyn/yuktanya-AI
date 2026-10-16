import { getSessionRoles } from "@/lib/supabase/server";
import { reviewService } from "@/lib/reviews/runtime";
import { assignAction, reassignAction } from "@/app/(partner)/partner/actions";

export const dynamic = "force-dynamic";
const ERR: Record<string, string> = {
  FORBIDDEN: "Tidak berwenang.", REVIEWER_NOT_AUTHORIZED: "Reviewer tidak memiliki otorisasi aktif.", REVIEWER_AT_CAPACITY: "Reviewer sudah penuh.",
  NOT_FOUND: "Permintaan tidak ditemukan.", NOT_ASSIGNABLE: "Permintaan ini tidak dapat ditugaskan lagi.",
};
const CATEGORY: Record<string, string> = { PKS: "Perjanjian Kerja Sama", UTANG_PIUTANG: "Surat Utang Piutang", NDA: "Perjanjian Kerahasiaan (NDA)" };

// Admin hanya merutekan pekerjaan (termasuk permintaan tanpa firma); tidak pernah memeriksa atau menerbitkan hasil.
export default async function RoutingPage({ searchParams }: { searchParams: Promise<{ e?: string; ok?: string }> }) {
  const q = await searchParams;
  const s = (await getSessionRoles())!;
  const svc = reviewService();
  const [unassigned, reviewers, inflight] = await Promise.all([svc.unassigned(s.userId), svc.reviewers(s.userId), svc.inflight(s.userId)]);
  const select = (
    <select name="reviewerId" className="mt-1 block min-h-12 rounded-lg border border-slate-400 px-3">
      {reviewers.map((rv) => <option key={rv.reviewerId} value={rv.reviewerId}>Reviewer {rv.reviewerId.slice(0, 8)} ({rv.active} aktif)</option>)}
    </select>
  );
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-3xl font-semibold">Perutean Review</h1>
      {q.e && <p role="alert" className="font-semibold text-red-800">{ERR[q.e] ?? "Terjadi kendala."}</p>}
      {q.ok && <p role="status" className="rounded-lg border border-slate-300 bg-white p-3">Penugasan disimpan.</p>}
      <section aria-labelledby="belum-h" className="space-y-3">
        <h2 id="belum-h" className="text-2xl font-semibold">Belum ditugaskan ({unassigned.length})</h2>
        {unassigned.map((r) => (
          <form key={r.requestId} action={assignAction} className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-300 bg-white p-4">
            <input type="hidden" name="requestId" value={r.requestId} />
            <p className="w-full font-semibold">{CATEGORY[r.category] ?? r.category}</p>
            <label className="block"><span className="font-medium">Tugaskan kepada</span>{select}</label>
            <button type="submit" className="min-h-12 rounded-lg bg-blue-600 px-5 font-semibold text-white">Tugaskan</button>
          </form>
        ))}
      </section>
      <section aria-labelledby="jalan-h" className="space-y-3">
        <h2 id="jalan-h" className="text-2xl font-semibold">Sedang dikerjakan ({inflight.length})</h2>
        {inflight.map((r) => (
          <form key={r.requestId} action={reassignAction} className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-300 bg-white p-4">
            <input type="hidden" name="requestId" value={r.requestId} />
            <p className="w-full font-semibold">{CATEGORY[r.category] ?? r.category} · Reviewer {r.reviewerId.slice(0, 8)}{!r.reviewerAuthorized ? " · otorisasi tidak aktif" : ""}</p>
            <label className="block"><span className="font-medium">Pindahkan ke</span>{select}</label>
            <button type="submit" className="min-h-12 rounded-lg border border-slate-400 bg-white px-5 font-medium">Pindahkan</button>
          </form>
        ))}
      </section>
    </main>
  );
}

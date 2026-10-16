import Link from "next/link";
import { getSessionRoles } from "@/lib/supabase/server";
import { deepService } from "@/lib/deep/runtime";
import { reviewService } from "@/lib/reviews/runtime";
import { assignAction, reassignAction } from "./actions";
import { assignDeepAction } from "./deep-actions";

export const dynamic = "force-dynamic";
const ERR: Record<string, string> = {
  FORBIDDEN: "Anda tidak berwenang menugaskan permintaan ini.",
  REVIEWER_NOT_AUTHORIZED: "Reviewer ini tidak memiliki otorisasi aktif untuk firma ini.",
  REVIEWER_AT_CAPACITY: "Reviewer ini sudah mencapai batas pekerjaan aktif.",
  NOT_FOUND: "Permintaan tidak ditemukan.",
  NOT_ASSIGNABLE: "Permintaan ini tidak dapat ditugaskan lagi.",
};
const CATEGORY: Record<string, string> = { PKS: "Perjanjian Kerja Sama", UTANG_PIUTANG: "Surat Utang Piutang", NDA: "Perjanjian Kerahasiaan (NDA)" };
const age = (iso: string) => `${Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000))} jam`;

export default async function PartnerPage({ searchParams }: { searchParams: Promise<{ e?: string; ok?: string; done?: string }> }) {
  const q = await searchParams;
  const s = (await getSessionRoles())!;
  const svc = reviewService();
  const isReviewer = s.roles.includes("reviewer");
  const isCoordinator = s.roles.includes("partner_admin");
  const queue = isReviewer ? await svc.queue(s.userId) : [];
  const dq = deepService();
  const deepQueue = isReviewer ? await dq.queue(s.userId) : [];
  const deepCoord = isCoordinator ? { requests: await dq.unassigned(s.userId), inflight: await dq.inflight(s.userId) } : null;
  const coord = isCoordinator ? { requests: await svc.unassigned(s.userId), reviewers: await svc.reviewers(s.userId), inflight: await svc.inflight(s.userId) } : null;
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-3xl font-semibold">Dashboard Mitra Hukum</h1>
      {q.e && <p role="alert" className="font-semibold text-danger">{ERR[q.e] ?? "Terjadi kendala. Coba lagi."}</p>}
      {q.done && <p role="status" className="rounded-lg border border-line bg-white p-3">Pemeriksaan diselesaikan dengan hasil: {q.done}. Pemilik dokumen sudah diberi tahu.</p>}
      {q.ok && <p role="status" className="rounded-lg border border-line bg-white p-3">Penugasan disimpan.</p>}
      {isReviewer && (
        <section aria-labelledby="antrean-h" className="space-y-3">
          <h2 id="antrean-h" className="text-2xl font-semibold">Antrean saya</h2>
          {queue.length === 0 ? <p>Belum ada pekerjaan yang ditugaskan kepada Anda.</p> : (
            <ul className="space-y-3">
              {queue.map((r) => (
                <li key={r.requestId} className="rounded-lg border border-line bg-white p-4">
                  <Link className="inline-flex min-h-12 items-center text-lg font-semibold underline" href={`/partner/reviews/${r.requestId}`}>{CATEGORY[r.category] ?? r.category}</Link>
                  <p>Status: {r.status === "IN_REVIEW" ? "Sedang diperiksa" : "Ditugaskan"} · Usia {age(r.createdAt)}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {coord && (
        <section aria-labelledby="tugas-h" className="space-y-3">
          <h2 id="tugas-h" className="text-2xl font-semibold">Permintaan belum ditugaskan</h2>
          {coord.requests.length === 0 ? <p>Tidak ada permintaan yang menunggu penugasan.</p> : (
            <ul className="space-y-3">
              {coord.requests.map((r) => (
                <li key={r.requestId} className="space-y-2 rounded-lg border border-line bg-white p-4">
                  <p className="font-semibold">{CATEGORY[r.category] ?? r.category} · Usia {age(r.createdAt)}</p>
                  {coord.reviewers.length === 0 ? <p>Belum ada reviewer di firma Anda.</p> : (
                    <form action={assignAction} className="flex flex-wrap items-end gap-3">
                      <input type="hidden" name="requestId" value={r.requestId} />
                      <label className="block">
                        <span className="font-medium">Tugaskan kepada</span>
                        <select name="reviewerId" className="mt-1 block min-h-12 rounded-lg border border-slate-400 px-3">
                          {coord.reviewers.map((rv) => <option key={rv.reviewerId} value={rv.reviewerId}>Reviewer {rv.reviewerId.slice(0, 8)} ({rv.active} aktif)</option>)}
                        </select>
                      </label>
                      <button type="submit" className="min-h-12 rounded-lg bg-brand hover:bg-brand-dark px-5 font-semibold text-white">Tugaskan</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {deepQueue.length > 0 && (
        <section aria-labelledby="deepq-h" className="space-y-3">
          <h2 id="deepq-h" className="text-2xl font-semibold">Pemeriksaan mendalam saya</h2>
          <ul className="space-y-3">
            {deepQueue.map((r) => (
              <li key={r.deepId} className="rounded-lg border border-line bg-white p-4">
                <Link className="inline-flex min-h-12 items-center text-lg font-semibold underline" href={`/partner/deep/${r.deepId}`}>{CATEGORY[r.category] ?? r.category}</Link>
                <p>Status: {r.status === "IN_REVIEW" ? "Sedang diperiksa" : "Ditugaskan"} · Usia {age(r.createdAt)}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
      {deepCoord && (deepCoord.requests.length > 0 || deepCoord.inflight.length > 0) && coord && (
        <section aria-labelledby="deepc-h" className="space-y-3">
          <h2 id="deepc-h" className="text-2xl font-semibold">Pemeriksaan mendalam: penugasan</h2>
          {[...deepCoord.requests.map((r) => ({ id: r.deepId, mode: "assign", note: "Belum ditugaskan", ok: true, cat: r.category })), ...deepCoord.inflight.map((r) => ({ id: r.deepId, mode: "reassign", note: r.reviewerAuthorized ? `Dikerjakan ${r.reviewerId.slice(0, 8)}` : `Dikerjakan ${r.reviewerId.slice(0, 8)} (otorisasi tidak aktif)`, ok: r.reviewerAuthorized, cat: r.category }))].map((r) => (
            <form key={r.id} action={assignDeepAction} className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-white p-4">
              <input type="hidden" name="deepId" value={r.id} /><input type="hidden" name="mode" value={r.mode} />
              <p className={`w-full font-semibold ${r.ok ? "" : "text-danger"}`}>{CATEGORY[r.cat] ?? r.cat} · {r.note}</p>
              <label className="block"><span className="font-medium">{r.mode === "assign" ? "Tugaskan kepada" : "Pindahkan ke"}</span>
                <select name="reviewerId" className="mt-1 block min-h-12 rounded-lg border border-slate-400 px-3">{coord.reviewers.map((rv) => <option key={rv.reviewerId} value={rv.reviewerId}>Reviewer {rv.reviewerId.slice(0, 8)} ({rv.active} aktif)</option>)}</select>
              </label>
              <button type="submit" className="min-h-12 rounded-lg bg-brand hover:bg-brand-dark px-5 font-semibold text-white">Simpan</button>
            </form>
          ))}
        </section>
      )}
      {coord && coord.inflight.length > 0 && (
        <section aria-labelledby="jalan-h" className="space-y-3">
          <h2 id="jalan-h" className="text-2xl font-semibold">Sedang dikerjakan</h2>
          <ul className="space-y-3">
            {coord.inflight.map((r) => (
              <li key={r.requestId} className="space-y-2 rounded-lg border border-line bg-white p-4">
                <p className="font-semibold">{CATEGORY[r.category] ?? r.category} · Usia {age(r.createdAt)} · Reviewer {r.reviewerId.slice(0, 8)}</p>
                {!r.reviewerAuthorized && <p role="alert" className="font-semibold text-danger">Otorisasi reviewer ini tidak aktif. Pindahkan penugasan.</p>}
                <form action={reassignAction} className="flex flex-wrap items-end gap-3">
                  <input type="hidden" name="requestId" value={r.requestId} />
                  <label className="block">
                    <span className="font-medium">Pindahkan ke</span>
                    <select name="reviewerId" className="mt-1 block min-h-12 rounded-lg border border-slate-400 px-3">
                      {coord.reviewers.map((rv) => <option key={rv.reviewerId} value={rv.reviewerId}>Reviewer {rv.reviewerId.slice(0, 8)} ({rv.active} aktif)</option>)}
                    </select>
                  </label>
                  <button type="submit" className="min-h-12 rounded-lg border border-slate-400 bg-white px-5 font-medium">Pindahkan</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}
      {!isReviewer && !coord && <p>Akun ini belum memiliki tugas di dashboard mitra.</p>}
    </main>
  );
}

import { PageHeading } from "@/components/ui/card";
import { fieldClass, labelText } from "@/components/ui/field";
import { buttonClass } from "@/components/ui/button";
import { getSessionRoles } from "@/lib/supabase/server";
import { reviewService } from "@/lib/reviews/runtime";
import { assignAction, reassignAction } from "@/app/(partner)/partner/actions";
import { assignDeepAction } from "@/app/(partner)/partner/deep-actions";
import { deepService } from "@/lib/deep/runtime";
import { INVALID_FORM_TEXT } from "@/lib/partner/form";
import { fixedText } from "@/lib/query-text";

export const dynamic = "force-dynamic";
export const metadata = { title: "Perutean review | Admin Yuktanya" };
const ERR: Record<string, string> = {
  FORBIDDEN: "Tidak berwenang.", REVIEWER_NOT_AUTHORIZED: "Reviewer tidak memiliki otorisasi aktif.", REVIEWER_AT_CAPACITY: "Reviewer sudah penuh.",
  NOT_FOUND: "Permintaan tidak ditemukan.", NOT_ASSIGNABLE: "Permintaan ini tidak dapat ditugaskan lagi.",
  CONFLICT_OF_INTEREST: "Reviewer ini berasal dari firma yang mencatat konflik kepentingan dengan pemilik dokumen. Pilih reviewer dari firma lain.",
  INVALID_REQUEST: INVALID_FORM_TEXT,
};
const CONFLICT_NOTE = "Konflik kepentingan firma tercatat. Jangan tugaskan ke reviewer firma yang berkonflik; pilih reviewer dari firma lain.";
const CATEGORY: Record<string, string> = { PKS: "Perjanjian Kerja Sama", UTANG_PIUTANG: "Surat Utang Piutang", NDA: "Perjanjian Kerahasiaan (NDA)", UPLOAD: "Dokumen unggahan" };

// Admin hanya merutekan pekerjaan (termasuk permintaan tanpa firma); tidak pernah memeriksa atau menerbitkan hasil.
export default async function RoutingPage({ searchParams }: { searchParams: Promise<{ e?: string; ok?: string }> }) {
  const q = await searchParams;
  const s = (await getSessionRoles())!;
  const svc = reviewService();
  const [unassigned, reviewers, inflight] = await Promise.all([svc.unassigned(s.userId), svc.reviewers(s.userId), svc.inflight(s.userId)]);
  const [dUn, dIn] = await Promise.all([deepService().unassigned(s.userId), deepService().inflight(s.userId)]);
  const select = (
    <select name="reviewerId" className={fieldClass}>
      {reviewers.map((rv) => <option key={rv.reviewerId} value={rv.reviewerId}>{rv.email} ({rv.active} aktif)</option>)}
    </select>
  );
  return (
    <main className="max-w-5xl space-y-6">
      <PageHeading title="Perutean Review" />
      {q.e && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 font-semibold text-danger">{fixedText(ERR, q.e) ?? "Terjadi kendala."}</p>}
      {q.ok && <p role="status" className="rounded-xl border border-green-300 bg-green-50 p-4 font-semibold text-green-900">Penugasan disimpan.</p>}
      <section aria-labelledby="belum-h" className="space-y-3">
        <h2 id="belum-h" className="text-xl font-bold text-navy md:text-2xl">Belum ditugaskan ({unassigned.length})</h2>
        {unassigned.map((r) => (
          <form key={r.requestId} action={assignAction} className="flex flex-wrap items-end gap-3 rounded-2xl border border-line bg-surface p-5">
            <input type="hidden" name="requestId" value={r.requestId} />
            <p className="w-full break-words font-semibold text-navy">{CATEGORY[r.category] ?? r.category}</p>
            {r.conflict && <p role="status" className="w-full rounded-xl border border-amber-400 bg-amber-50 p-3 text-amber-950">{CONFLICT_NOTE}</p>}
            <label className="block min-w-0 flex-1 basis-56"><span className={labelText}>Tugaskan kepada</span>{select}</label>
            <button type="submit" className={buttonClass("primary")}>Tugaskan</button>
          </form>
        ))}
      </section>
      <section aria-labelledby="jalan-h" className="space-y-3">
        <h2 id="jalan-h" className="text-xl font-bold text-navy md:text-2xl">Sedang dikerjakan ({inflight.length})</h2>
        {inflight.map((r) => (
          <form key={r.requestId} action={reassignAction} className="flex flex-wrap items-end gap-3 rounded-2xl border border-line bg-surface p-5">
            <input type="hidden" name="requestId" value={r.requestId} />
            <p className="w-full break-words font-semibold text-navy">{CATEGORY[r.category] ?? r.category} · Reviewer {r.reviewerId.slice(0, 8)}{!r.reviewerAuthorized ? " · otorisasi tidak aktif" : ""}</p>
            <label className="block min-w-0 flex-1 basis-56"><span className={labelText}>Pindahkan ke</span>{select}</label>
            <button type="submit" className={buttonClass("secondary")}>Pindahkan</button>
          </form>
        ))}
      </section>
      <section aria-labelledby="deep-h" className="space-y-3">
        <h2 id="deep-h" className="text-xl font-bold text-navy md:text-2xl">Pemeriksaan mendalam ({dUn.length + dIn.length})</h2>
        {[...dUn.map((r) => ({ id: r.deepId, mode: "assign", note: "Belum ditugaskan", cat: r.category, conflict: r.conflict })), ...dIn.map((r) => ({ id: r.deepId, mode: "reassign", note: `Reviewer ${r.reviewerId.slice(0, 8)}${r.reviewerAuthorized ? "" : " · otorisasi tidak aktif"}`, cat: r.category, conflict: false }))].map((r) => (
          <form key={r.id} action={assignDeepAction} className="flex flex-wrap items-end gap-3 rounded-2xl border border-line bg-surface p-5">
            <input type="hidden" name="deepId" value={r.id} /><input type="hidden" name="mode" value={r.mode} />
            <p className="w-full break-words font-semibold text-navy">{CATEGORY[r.cat] ?? r.cat} · {r.note}</p>
            {r.conflict && <p role="status" className="w-full rounded-xl border border-amber-400 bg-amber-50 p-3 text-amber-950">{CONFLICT_NOTE}</p>}
            <label className="block min-w-0 flex-1 basis-56"><span className={labelText}>{r.mode === "assign" ? "Tugaskan kepada" : "Pindahkan ke"}</span>{select}</label>
            <button type="submit" className={buttonClass("primary")}>Simpan</button>
          </form>
        ))}
      </section>
    </main>
  );
}

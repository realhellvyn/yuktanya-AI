import Link from "next/link";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, EmptyState, PageHeading } from "@/components/ui/card";
import { fieldClass, labelText } from "@/components/ui/field";
import { StatusBadge } from "@/components/ui/status-badge";
import { getSessionRoles } from "@/lib/supabase/server";
import { deepService } from "@/lib/deep/runtime";
import { ageHours as age, categoryLabel } from "@/lib/partner/labels";
import { reviewService } from "@/lib/reviews/runtime";
import { INVALID_FORM_TEXT } from "@/lib/partner/form";
import { assignAction, declareConflictAction, reassignAction } from "./actions";
import { assignDeepAction } from "./deep-actions";
import { fixedText } from "@/lib/query-text";

export const dynamic = "force-dynamic";
export const metadata = { title: "Antrean Legal Review dan Deep Review | Mitra Hukum Yuktanya" };
const ERR: Record<string, string> = {
  FORBIDDEN: "Akun Anda tidak berwenang menugaskan permintaan ini.",
  REVIEWER_NOT_AUTHORIZED: "Pemeriksa ini tidak memiliki otorisasi aktif untuk firma ini. Pilih pemeriksa lain.",
  REVIEWER_AT_CAPACITY: "Pemeriksa ini sudah mencapai batas pekerjaan aktif. Pilih pemeriksa lain.",
  NOT_FOUND: "Permintaan tidak ditemukan. Muat ulang halaman.",
  NOT_ASSIGNABLE: "Permintaan ini tidak dapat ditugaskan lagi. Muat ulang halaman untuk melihat status terbaru.",
  CONFLICT_OF_INTEREST: "Firma Anda sudah mencatat konflik kepentingan dengan pemilik dokumen ini, sehingga permintaan ini tidak dapat ditugaskan.",
  CONFLICT_CONFIRM_REQUIRED: "Centang pernyataan konflik kepentingan sebelum menyimpan.",
  INVALID_REQUEST: INVALID_FORM_TEXT,
};
const OK: Record<string, string> = {
  assigned: "Penugasan disimpan.",
  conflict: "Konflik kepentingan firma sudah dicatat. Permintaan ini tidak akan ditugaskan di firma Anda, dan admin platform akan menindaklanjutinya.",
};
const DONE: Record<string, string> = {
  WITH_NOTES: "Selesai dengan Legal Note", WITHIN_SCOPE: "Selesai tanpa Legal Note", INCONCLUSIVE: "Belum dapat disimpulkan", DECLINED: "Tidak dapat memeriksa",
  ENHANCED_APPROVED: "Enhanced disetujui", COMPLETED_WITH_NOTES: "Selesai dengan catatan (tanpa Enhanced)", REFERRED_SPECIAL_CASE: "Dirujuk sebagai Special Legal Case",
};
const H2 = "text-xl font-bold text-navy md:text-2xl";
const statusText = (s: string) => (s === "IN_REVIEW" ? "Sedang diperiksa" : "Ditugaskan, belum dibuka");

function ReviewerSelect({ reviewers, label }: { reviewers: { reviewerId: string; email: string; active: number }[]; label: string }) {
  return (
    <label className="block min-w-0 flex-1 basis-56">
      <span className={labelText}>{label}</span>
      <select name="reviewerId" className={fieldClass}>
        {reviewers.map((rv) => <option key={rv.reviewerId} value={rv.reviewerId}>{rv.email} ({rv.active} aktif)</option>)}
      </select>
    </label>
  );
}

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
  const nameOf = (id: string) => coord?.reviewers.find((x) => x.reviewerId === id)?.email ?? id.slice(0, 8);
  return (
    <main className="max-w-4xl space-y-8">
      <PageHeading title="Dashboard Mitra Hukum" lead="Antrean Legal Review dan Deep Review yang menjadi tanggung jawab Anda."
        actions={isReviewer ? <ButtonLink href="/partner/approvals" variant="secondary">Lihat yang siap diputuskan</ButtonLink> : undefined} />
      {q.e && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 font-semibold text-danger">{fixedText(ERR, q.e) ?? "Tindakan belum berhasil. Muat ulang halaman, lalu coba lagi."}</p>}
      {fixedText(DONE, q.done) && <p role="status" className="rounded-xl border border-green-300 bg-green-50 p-4 font-semibold text-green-900">Pemeriksaan selesai dengan hasil: {fixedText(DONE, q.done)}. Pemilik dokumen sudah diberi tahu.</p>}
      {q.ok && <p role="status" className="rounded-xl border border-green-300 bg-green-50 p-4 font-semibold text-green-900">{fixedText(OK, q.ok) ?? "Tersimpan."}</p>}

      {isReviewer && (
        <section aria-labelledby="antrean-h" className="space-y-3">
          <h2 id="antrean-h" className={H2}>Legal Review saya</h2>
          {queue.length === 0 ? <EmptyState title="Belum ada pekerjaan" text="Belum ada Legal Review yang ditugaskan kepada Anda." /> : (
            <ul className="space-y-3">
              {queue.map((r) => (
                <li key={r.requestId}>
                  <Card className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <Link className="inline-flex min-h-12 items-center text-lg font-semibold text-link underline underline-offset-4" href={`/partner/reviews/${r.requestId}`}>{categoryLabel(r.category)}</Link>
                      <p className="text-muted">Legal Review · Usia {age(r.createdAt)}</p>
                    </div>
                    <StatusBadge tone={r.status === "IN_REVIEW" ? "info" : "warning"}>{statusText(r.status)}</StatusBadge>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {deepQueue.length > 0 && (
        <section aria-labelledby="deepq-h" className="space-y-3">
          <h2 id="deepq-h" className={H2}>Deep Review saya</h2>
          <ul className="space-y-3">
            {deepQueue.map((r) => (
              <li key={r.deepId}>
                <Card className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <Link className="inline-flex min-h-12 items-center text-lg font-semibold text-link underline underline-offset-4" href={`/partner/deep/${r.deepId}`}>{categoryLabel(r.category)}</Link>
                    <p className="text-muted">Deep Review · Usia {age(r.createdAt)}</p>
                  </div>
                  <StatusBadge tone={r.status === "IN_REVIEW" ? "info" : "warning"}>{statusText(r.status)}</StatusBadge>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}

      {coord && (
        <section aria-labelledby="tugas-h" id="penugasan" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="tugas-h" className={H2}>Legal Review belum ditugaskan</h2>
            <ButtonLink href="/partner/team" variant="quiet">Lihat tim firma</ButtonLink>
          </div>
          {coord.requests.length === 0 ? <EmptyState title="Tidak ada permintaan baru" text="Tidak ada permintaan yang menunggu penugasan." /> : (
            <ul className="space-y-3">
              {coord.requests.map((r) => (
                <li key={r.requestId}>
                  <Card className="space-y-3">
                    <p className="font-semibold text-navy">{categoryLabel(r.category)} · Usia {age(r.createdAt)}</p>
                    {r.conflict ? (
                      <p role="status" className="rounded-xl border border-amber-400 bg-amber-50 p-3 text-amber-950">Konflik kepentingan firma sudah dicatat. Permintaan ini tidak ditugaskan di firma Anda, dan admin platform akan menindaklanjutinya.</p>
                    ) : coord.reviewers.length === 0 ? <p>Belum ada pemeriksa di firma Anda. Minta admin platform menambahkan pemeriksa.</p> : (
                      <form action={assignAction} className="flex flex-wrap items-end gap-3">
                        <input type="hidden" name="requestId" value={r.requestId} />
                        <ReviewerSelect reviewers={coord.reviewers} label="Tugaskan kepada" />
                        <Button type="submit">Tugaskan</Button>
                      </form>
                    )}
                    {!r.conflict && (
                      <form action={declareConflictAction} className="space-y-2 border-t border-line pt-3">
                        <input type="hidden" name="requestId" value={r.requestId} />
                        <label className="flex min-h-12 items-start gap-3"><input type="checkbox" name="confirm" value="yes" required className="mt-1 h-6 w-6 shrink-0" /><span>Firma kami memiliki konflik kepentingan dengan pemilik dokumen ini.</span></label>
                        <Button type="submit" variant="secondary">Catat konflik kepentingan</Button>
                      </form>
                    )}
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {deepCoord && (deepCoord.requests.length > 0 || deepCoord.inflight.length > 0) && coord && (
        <section aria-labelledby="deepc-h" className="space-y-3">
          <h2 id="deepc-h" className={H2}>Penugasan Deep Review</h2>
          {[...deepCoord.requests.map((r) => ({ id: r.deepId, mode: "assign", note: "Belum ditugaskan", ok: true, cat: r.category })), ...deepCoord.inflight.map((r) => ({ id: r.deepId, mode: "reassign", note: r.reviewerAuthorized ? `Dikerjakan ${nameOf(r.reviewerId)}` : `Dikerjakan ${nameOf(r.reviewerId)} (otorisasi tidak aktif)`, ok: r.reviewerAuthorized, cat: r.category }))].map((r) => (
            <Card key={r.id}>
              <form action={assignDeepAction} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="deepId" value={r.id} /><input type="hidden" name="mode" value={r.mode} />
                <p className={`w-full break-words font-semibold ${r.ok ? "text-navy" : "text-danger"}`}>{categoryLabel(r.cat)} · {r.note}</p>
                <ReviewerSelect reviewers={coord.reviewers} label={r.mode === "assign" ? "Tugaskan kepada" : "Pindahkan ke"} />
                <Button type="submit">Simpan</Button>
              </form>
            </Card>
          ))}
        </section>
      )}

      {coord && coord.inflight.length > 0 && (
        <section aria-labelledby="jalan-h" className="space-y-3">
          <h2 id="jalan-h" className={H2}>Legal Review yang sedang dikerjakan</h2>
          <ul className="space-y-3">
            {coord.inflight.map((r) => (
              <li key={r.requestId}>
                <Card className="space-y-3">
                  <p className="break-words font-semibold text-navy">{categoryLabel(r.category)} · Usia {age(r.createdAt)} · Pemeriksa {nameOf(r.reviewerId)}</p>
                  {!r.reviewerAuthorized && <p role="alert" className="font-semibold text-danger">Otorisasi pemeriksa ini tidak aktif. Pindahkan penugasan ke pemeriksa lain.</p>}
                  <form action={reassignAction} className="flex flex-wrap items-end gap-3">
                    <input type="hidden" name="requestId" value={r.requestId} />
                    <ReviewerSelect reviewers={coord.reviewers} label="Pindahkan ke" />
                    <Button type="submit" variant="secondary">Pindahkan</Button>
                  </form>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}
      {!isReviewer && !coord && <EmptyState title="Belum ada tugas" text="Akun ini belum memiliki tugas di Dashboard Mitra Hukum." />}
    </main>
  );
}

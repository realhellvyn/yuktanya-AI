import { Card, EmptyState, PageHeading } from "@/components/ui/card";
import { buttonClass } from "@/components/ui/button";
import { fieldClass, labelText } from "@/components/ui/field";
import { StatusBadge } from "@/components/ui/status-badge";
import { adminService } from "@/lib/admin/runtime";
import { casesService } from "@/lib/cases/runtime";
import { CASE_STATUS_LABEL, CASE_STATUS_TONE, caseErrorText, formatWib } from "@/lib/cases/view";
import { formatIdr } from "@/lib/pricing/catalog";
import { getSessionRoles } from "@/lib/supabase/server";
import { routeCaseAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Special Legal Case | Admin Yuktanya" };

// Admin melihat metadata operasional (tanpa ringkasan pemilik) dan hanya dapat merutekan ke firma. Triase/penawaran = keputusan firma.
export default async function AdminCasesPage({ searchParams }: { searchParams: Promise<{ e?: string; ok?: string }> }) {
  const q = await searchParams;
  const s = (await getSessionRoles())!;
  const [rows, partners] = await Promise.all([casesService().adminList(s.userId), adminService().partners(s.userId)]);
  const firms = [...new Map(partners.map((p) => [p.firmId, p.firmName])).entries()];
  return (
    <main className="max-w-5xl space-y-6">
      <PageHeading title="Special Legal Case" lead="Pemantauan dan penugasan ke firma. Ringkasan kasus hanya dapat dibaca firma yang menangani." />
      {q.ok && <p role="status" className="rounded-xl border border-green-300 bg-green-50 p-4 font-semibold text-green-900">Tersimpan. Firma tujuan perlu melakukan triase.</p>}
      {q.e && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 font-semibold text-danger">{caseErrorText(q.e)}</p>}
      {rows.length === 0 ? <EmptyState title="Belum ada Special Legal Case" /> : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.id}>
              <Card className="space-y-2 !p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <StatusBadge tone={CASE_STATUS_TONE[r.status]}>{CASE_STATUS_LABEL[r.status]}</StatusBadge>
                  <span className="text-muted">Masuk {formatWib(r.createdAt)}</span>
                </div>
                <p className="break-words">Firma: <strong>{r.firmName ?? "Belum ditugaskan ke firma"}</strong>{r.quoteAmountIdr != null ? ` · Penawaran ${formatIdr(r.quoteAmountIdr)}` : ""}</p>
                {(r.status === "SUBMITTED" || r.status === "TRIAGED") && firms.length > 0 && (
                  <form action={routeCaseAction} className="flex flex-wrap items-end gap-3">
                    <input type="hidden" name="caseId" value={r.id} />
                    <label className="block min-w-0 flex-1"><span className={labelText}>Tugaskan ke firma</span>
                      <select name="firmId" defaultValue={r.firmId ?? ""} required className={fieldClass}>
                        <option value="" disabled>Pilih firma</option>
                        {firms.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                      </select>
                    </label>
                    <button type="submit" className={buttonClass("secondary")}>Tugaskan ke firma</button>
                  </form>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

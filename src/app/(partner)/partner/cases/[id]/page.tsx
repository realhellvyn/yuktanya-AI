import { notFound } from "next/navigation";
import { QuoteForm } from "@/components/cases/quote-form";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, PageHeading } from "@/components/ui/card";
import { fieldClass, labelText } from "@/components/ui/field";
import { StatusBadge } from "@/components/ui/status-badge";
import { loadPartnerCasePage } from "@/lib/cases/pages";
import { casesService } from "@/lib/cases/runtime";
import { CASE_STATUS_LABEL, CASE_STATUS_TONE, caseErrorText, formatWib, quoteExpired } from "@/lib/cases/view";
import { categoryLabel } from "@/lib/partner/labels";
import { formatIdr } from "@/lib/pricing/catalog";
import { getSessionRoles } from "@/lib/supabase/server";
import { closeCaseAction, quoteCaseAction, triageCaseAction } from "../actions";
import { fixedText } from "@/lib/query-text";

export const dynamic = "force-dynamic";
export const metadata = { title: "Special Legal Case | Mitra Hukum Yuktanya" };

const OK: Record<string, string> = {
  triase: "✓ Triase tersimpan. Kirim penawaran bila firma dapat menangani kasus ini.",
  penawaran: "✓ Penawaran terkirim ke pemilik dokumen.",
  ditutup: "✓ Kasus ditutup.",
};
const ymdWib = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(d);

export default async function PartnerCasePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; e?: string }> }) {
  const { id } = await params;
  const q = await searchParams;
  const s = (await getSessionRoles())!;
  if (!s.roles.includes("partner_admin")) notFound();
  const page = await loadPartnerCasePage(casesService(), s.userId, id);
  if (page.kind === "notFound") notFound();
  const { c } = page;
  const now = new Date();
  const error = caseErrorText(q.e);
  return (
    <main className="max-w-3xl space-y-6">
      <PageHeading title="Special Legal Case" lead={`${c.category ? categoryLabel(c.category) : "Tanpa dokumen terkait"} · ${c.firmName}`} />
      {fixedText(OK, q.ok) && <p role="status" className="rounded-xl border border-green-300 bg-green-50 p-4 font-semibold text-success">{fixedText(OK, q.ok)}</p>}
      {error && <p role="alert" className="rounded-xl border border-danger bg-red-50 p-4 font-semibold text-danger">{error}</p>}
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-xl font-semibold">Status</h2>
          <StatusBadge tone={CASE_STATUS_TONE[c.status]}>{CASE_STATUS_LABEL[c.status]}</StatusBadge>
        </div>
        <p className="text-muted">Masuk {formatWib(c.createdAt)}. Pemilik dokumen menyetujui berbagi ringkasan pada {formatWib(c.consentAt)}.</p>
        <h3 className="font-semibold">Ringkasan dari pemilik dokumen</h3>
        <p className="whitespace-pre-wrap break-words rounded-xl border border-line bg-subtle p-3">{c.summary}</p>
      </Card>

      {c.status === "SUBMITTED" && (
        <Card className="space-y-3">
          <h2 className="text-xl font-semibold">Triase</h2>
          <form action={triageCaseAction} className="space-y-3">
            <input type="hidden" name="caseId" value={c.id} />
            <label className="flex min-h-12 items-start gap-3">
              <input type="checkbox" name="conflictCleared" value="yes" required className="mt-1 h-6 w-6 shrink-0" />
              <span>Pemeriksaan konflik kepentingan sudah dilakukan dan tidak ada konflik.</span>
            </label>
            <Button type="submit">Simpan triase</Button>
          </form>
          <p className="text-muted">Bila ada konflik kepentingan atau firma tidak dapat menangani kasus ini, tutup kasus di bawah dengan alasan singkat.</p>
        </Card>
      )}

      {c.quote && (
        <Card className="space-y-2">
          <h2 className="text-xl font-semibold">Penawaran terakhir (revisi {c.quote.revision})</h2>
          <p>Biaya: <strong>{formatIdr(c.quote.amountIdr)}</strong></p>
          <p className="whitespace-pre-wrap break-words">Ruang lingkup: {c.quote.scope}</p>
          <p>Berlaku sampai {formatWib(c.quote.expiresAt)}{quoteExpired(c.quote.expiresAt, now) ? " (sudah kedaluwarsa)" : ""}</p>
          {c.status === "ACCEPTED" && <p role="status" className="font-semibold">Diterima pemilik pada {formatWib(c.decidedAt!)}. Atur perjanjian kerja dan pembayaran secara terpisah; sistem tidak membuat tagihan otomatis.</p>}
          {c.status === "DECLINED" && <p role="status" className="font-semibold">Ditolak pemilik.</p>}
        </Card>
      )}

      {(c.status === "TRIAGED" || c.status === "QUOTED") && (
        <Card className="space-y-3">
          <h2 className="text-xl font-semibold">{c.status === "QUOTED" ? "Perbarui penawaran" : "Kirim penawaran"}</h2>
          <QuoteForm action={quoteCaseAction} caseId={c.id} isRevision={c.status === "QUOTED"}
            minDate={ymdWib(new Date(now.getTime() + 86_400_000))} maxDate={ymdWib(new Date(now.getTime() + 89 * 86_400_000))} />
        </Card>
      )}

      {c.status !== "CLOSED" ? (
        <Card className="space-y-3">
          <h2 className="text-xl font-semibold">Tutup kasus</h2>
          <form action={closeCaseAction} className="space-y-3">
            <input type="hidden" name="caseId" value={c.id} />
            <label className="block">
              <span className={labelText}>Alasan singkat (dapat dilihat pemilik dokumen)</span>
              <input name="reason" maxLength={500} required className={fieldClass} />
            </label>
            <Button type="submit" variant="secondary">Tutup kasus</Button>
          </form>
        </Card>
      ) : (
        <Card><p className="font-semibold">Kasus ditutup{c.closeReason ? `: ${c.closeReason}` : "."}</p></Card>
      )}
      <ButtonLink href="/partner/cases" variant="secondary">Semua Special Legal Case</ButtonLink>
    </main>
  );
}

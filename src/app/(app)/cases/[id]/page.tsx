import { notFound } from "next/navigation";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, PageHeading } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { SPECIAL_CASE_NOTE } from "@/lib/copy";
import { loadOwnerCasePage } from "@/lib/cases/pages";
import { casesService } from "@/lib/cases/runtime";
import { CASE_STATUS_LABEL, CASE_STATUS_TONE, caseErrorText, caseTimeline, formatWib, quoteExpired } from "@/lib/cases/view";
import { requireUserId } from "@/lib/documents/session";
import { formatIdr } from "@/lib/pricing/catalog";
import { acceptQuoteAction, declineQuoteAction, withdrawCaseAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Status Kasus Khusus | Yuktanya" };

const OK: Record<string, string> = {
  dikirim: "✓ Permintaan terkirim. Firma hukum mitra akan menilainya lebih dulu.",
  diterima: "✓ Anda menerima penawaran. Belum ada tagihan yang dibuat; firma akan menghubungi Anda untuk perjanjian kerja dan pembayaran.",
  ditolak: "✓ Anda menolak penawaran. Tidak ada biaya.",
  ditarik: "✓ Permintaan ditarik dan ditutup.",
};

export default async function CasePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; e?: string }> }) {
  const { id } = await params;
  const q = await searchParams;
  const userId = await requireUserId();
  const page = await loadOwnerCasePage(casesService(), userId, id);
  if (page.kind === "notFound") notFound();
  const { c } = page;
  const expired = quoteExpired(c.quote?.expiresAt);
  const error = q.e === "CONFIRM_REQUIRED" ? "Centang pernyataan bahwa Anda sudah membaca penawaran."
    : q.e === "WITHDRAW_CONFIRM" ? "Permintaan belum ditarik. Tekan “Ya, tarik permintaan” untuk memastikan." : caseErrorText(q.e);
  const canWithdraw = ["SUBMITTED", "TRIAGED", "QUOTED"].includes(c.status);
  return (
    <main className="max-w-3xl space-y-6">
      <PageHeading title="Kasus khusus" lead={c.documentTitle ? `Dokumen: ${c.documentTitle}` : "Tanpa dokumen terkait"} />
      {q.ok && OK[q.ok] && <p role="status" className="rounded-xl border border-green-300 bg-green-50 p-4 font-semibold text-success">{OK[q.ok]}</p>}
      {error && <p role="alert" className="rounded-xl border border-danger bg-red-50 p-4 font-semibold text-danger">{error}</p>}
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-xl font-semibold">Status</h2>
          <StatusBadge tone={CASE_STATUS_TONE[c.status]}>{CASE_STATUS_LABEL[c.status]}</StatusBadge>
        </div>
        <ol aria-label="Tahapan kasus khusus" className="space-y-2">
          {caseTimeline(c.status).map((s) => (
            <li key={s.label} className="flex flex-wrap items-center gap-2">
              <span aria-hidden="true" className={s.state === "todo" ? "text-slate-500" : "font-bold"}>{s.state === "done" ? "✓" : s.state === "current" ? "●" : "○"}</span>
              <span className={s.state === "current" ? "font-semibold" : undefined}>{s.label}</span>
              <span className="text-slate-700">{s.state === "done" ? "— selesai" : s.state === "current" ? "— tahap ini" : "— belum"}</span>
            </li>
          ))}
        </ol>
        <p className="text-muted">Diajukan {formatWib(c.createdAt)}. Persetujuan berbagi diberikan {formatWib(c.consentAt)}.</p>
        <p>{SPECIAL_CASE_NOTE}</p>
      </Card>

      {c.quote && (
        <Card className="space-y-3 border-blue-200">
          <h2 className="text-xl font-semibold">Penawaran firma hukum</h2>
          <dl className="space-y-2">
            <div><dt className="font-semibold">Biaya</dt><dd className="text-2xl font-bold text-navy">{formatIdr(c.quote.amountIdr)}</dd></div>
            <div><dt className="font-semibold">Ruang lingkup</dt><dd className="whitespace-pre-wrap break-words">{c.quote.scope}</dd></div>
            <div><dt className="font-semibold">Berlaku sampai</dt><dd>{formatWib(c.quote.expiresAt)}{expired ? " — sudah kedaluwarsa" : ""}</dd></div>
          </dl>
          <p>Menerima penawaran belum membuat tagihan atau pembayaran otomatis. Pembayaran dan perjanjian kerja diatur terpisah dengan firma. Penawaran ini bukan hasil pemeriksaan dan tidak menjamin hasil hukum tertentu.</p>
          {c.status === "QUOTED" && !expired && (
            <div className="space-y-4">
              <form action={acceptQuoteAction} className="space-y-3">
                <input type="hidden" name="caseId" value={c.id} />
                <input type="hidden" name="revision" value={c.quote.revision} />
                <label className="flex min-h-12 items-start gap-3">
                  <input type="checkbox" name="confirm" value="yes" required className="mt-1 h-6 w-6 shrink-0" />
                  <span>Saya sudah membaca biaya, ruang lingkup, dan batas waktu penawaran ini.</span>
                </label>
                <Button type="submit">Terima penawaran</Button>
              </form>
              <form action={declineQuoteAction}>
                <input type="hidden" name="caseId" value={c.id} />
                <Button type="submit" variant="secondary">Tolak penawaran</Button>
              </form>
            </div>
          )}
          {c.status === "QUOTED" && expired && <p role="status" className="font-semibold">Penawaran sudah kedaluwarsa dan tidak dapat diterima. Firma dapat mengirim penawaran baru.</p>}
          {c.status === "ACCEPTED" && <p role="status" className="font-semibold">Anda menerima penawaran ini pada {formatWib(c.decidedAt!)}. Firma akan menghubungi Anda untuk langkah berikutnya.</p>}
          {c.status === "DECLINED" && <p role="status" className="font-semibold">Anda menolak penawaran ini. Tidak ada biaya.</p>}
        </Card>
      )}
      {!c.quote && ["SUBMITTED", "TRIAGED"].includes(c.status) && (
        <Card><p>Belum ada penawaran. Firma hukum mitra sedang menilai kebutuhan Anda. Status akan berubah di halaman ini.</p></Card>
      )}
      {c.status === "CLOSED" && <Card><p className="font-semibold">Kasus ini sudah ditutup{c.closeReason ? `: ${c.closeReason}` : "."}</p></Card>}

      <details className="rounded-2xl border border-line bg-white p-4">
        <summary className="inline-flex min-h-12 cursor-pointer items-center text-lg font-bold text-navy">Ringkasan yang Anda kirim</summary>
        <p className="mt-2 whitespace-pre-wrap break-words">{c.summary}</p>
      </details>

      <div className="flex flex-wrap gap-3">
        {c.documentId && <ButtonLink href={`/documents/${c.documentId}`} variant="secondary">Kembali ke dokumen</ButtonLink>}
        <ButtonLink href="/cases" variant="secondary">Semua kasus khusus</ButtonLink>
        {canWithdraw && (
          <details className="w-full">
            <summary className="inline-flex min-h-12 cursor-pointer items-center font-semibold text-brand underline underline-offset-4">Tarik permintaan</summary>
            <form action={withdrawCaseAction} className="mt-2 space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4">
              <input type="hidden" name="caseId" value={c.id} />
              <input type="hidden" name="confirm" value="yes" />
              <p>Yakin menarik permintaan ini? Kasus akan ditutup dan tidak dapat dibuka lagi. Anda dapat mengajukan permintaan baru nanti.</p>
              <Button type="submit" variant="secondary">Ya, tarik permintaan</Button>
            </form>
          </details>
        )}
      </div>
    </main>
  );
}

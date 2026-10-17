import Link from "next/link";
import { notFound } from "next/navigation";
import { isPastDue, OrderStatus } from "@/components/billing/order-status";
import { PriceBreakdown } from "@/components/billing/price-breakdown";
import { orderSubject } from "@/lib/billing/checkout-subject";
import { getPool } from "@/lib/db";
import { billingService } from "@/lib/billing/runtime";
import { requireUserId } from "@/lib/documents/session";
import { paymentReference } from "@/lib/reviews/paths";
import { mockSettleAction, payAction } from "../actions";
import { fixedText } from "@/lib/query-text";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pembayaran | Yuktanya" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOTICE: Record<string, string> = { PROVIDER_UNAVAILABLE: "Metode pembayaran ini belum tersedia. Pilih metode lain.", ORDER_NOT_PAYABLE: "Pesanan ini sudah tidak dapat dibayar. Buat pengajuan baru dari halaman dokumen.",
  SPECIAL_CASE_OPEN: "Dokumen ini sedang diajukan sebagai Special Legal Case, sehingga Legal Review belum dapat dibayar. Lihat statusnya di menu Special Legal Case, atau tarik pengajuan tersebut bila tidak jadi." };
const LABEL: Record<string, string> = { MEMBERSHIP_MONTHLY: "Membership Yuktanya (1 periode)", MEMBERSHIP_ANNUAL: "Membership Yuktanya (1 tahun)", BUNDLE: "Paket kredit Legal Review", STANDARD_REVIEW: "Legal Review oleh pengacara", DEEP_REVIEW: "Deep Review oleh pengacara (tambahan)" };
const btn = "min-h-12 rounded-lg px-5 font-semibold";

export default async function CheckoutPage({ params, searchParams }: { params: Promise<{ orderId: string }>; searchParams: Promise<{ notice?: string }> }) {
  const { orderId } = await params;
  const q = await searchParams;
  const userId = await requireUserId();
  if (!UUID.test(orderId)) notFound();
  const order = await billingService().getOrder(userId, orderId);
  if (!order) notFound();
  const pending = order.payments.find((p) => p.status === "PENDING");
  const manualText = process.env.MANUAL_PAYMENT_INSTRUCTIONS?.trim() || null;
  const subject = await orderSubject(getPool(), userId, order);
  const pastDue = isPastDue(order);
  const review = order.kind === "STANDARD_REVIEW" || order.kind === "DEEP_REVIEW";
  const production = process.env.NODE_ENV === "production";
  return (
    <main className="max-w-3xl space-y-6">
      <h1 className="text-[1.75rem] font-bold leading-tight tracking-tight text-navy md:text-4xl">Pembayaran</h1>
      {review && (
        <section aria-labelledby="dok-h" className="space-y-2 rounded-lg border border-line bg-surface p-4">
          <h2 id="dok-h" className="text-xl font-semibold">Dokumen yang akan diperiksa</h2>
          {subject ? (
            <dl className="space-y-1">
              <div><dt className="inline font-semibold">Dokumen: </dt><dd className="inline break-words">{subject.title}, versi {subject.versionNo}</dd></div>
              <div><dt className="inline font-semibold">Kode versi: </dt><dd className="inline font-mono">{subject.sha256.slice(0, 12)}</dd></div>
            </dl>
          ) : <p>Dokumen untuk pesanan ini tidak ditemukan.</p>}
          <p>
            <strong>Ruang lingkup: </strong>
            {order.kind === "DEEP_REVIEW"
              ? "pemeriksaan tambahan atas Legal Note (Catatan dari pemeriksa) dari Legal Review versi ini. Pengacara menuliskan ruang lingkup yang tepat di hasilnya."
              : "hanya isi versi ini, persis sesuai kode versi di atas. Versi lain atau perubahan sesudahnya tidak ikut diperiksa. Pengacara menuliskan ruang lingkup yang tepat di hasil pemeriksaan."}
          </p>
          <p><strong>Siapa yang memeriksa: </strong>profesional hukum dari firma mitra yang diberi wewenang oleh Yuktanya. AI tidak memberi persetujuan hukum.</p>
          <p><strong>Langkah berikutnya: </strong>setelah pembayaran dikonfirmasi, pengajuan Anda masuk antrean pemeriksaan. Pantau statusnya di menu Legal Review Saya.</p>
        </section>
      )}
      <PriceBreakdown service={LABEL[order.kind] ?? "Layanan Yuktanya"} quote={{ amountIdr: order.amountIdr, variant: order.variant ?? "", usesCredit: order.variant === "CREDIT" }} kind={order.kind} />
      {fixedText(NOTICE, q.notice) && <p role="alert" className="font-semibold text-danger">{fixedText(NOTICE, q.notice)}</p>}
      <OrderStatus order={order} />
      {order.status === "PENDING_PAYMENT" && !pastDue && (
        <section className="space-y-4" aria-label="Cara membayar">
          {pending?.provider === "manual" && (
            <div className="space-y-2 rounded-lg border border-line bg-surface p-4">
              <h2 className="text-xl font-semibold">Transfer bank</h2>
              {manualText ? <p className="whitespace-pre-line">{manualText}</p> : (
                <p>Instruksi transfer belum tersedia. Jangan melakukan transfer sekarang. <Link className="inline-flex min-h-12 items-center underline" href="/bantuan">Lihat halaman Bantuan</Link></p>
              )}
              <p>Tulis kode berikut pada berita transfer: <strong className="font-mono text-xl">{paymentReference(pending.id)}</strong></p>
              <p>Setelah Anda mentransfer, tim kami mengonfirmasi pembayaran secara manual. Status di halaman ini akan berubah setelah dikonfirmasi.</p>
            </div>
          )}
          {!pending && (
            <form action={payAction} className="space-y-3">
              <input type="hidden" name="orderId" value={order.id} />
              <input type="hidden" name="provider" value="manual" />
              <button type="submit" className={`${btn} bg-primary hover:bg-primary-hover text-on-primary`}>Bayar dengan transfer bank</button>
            </form>
          )}
          {!production && !pending && (
            <form action={payAction}>
              <input type="hidden" name="orderId" value={order.id} />
              <input type="hidden" name="provider" value="mock" />
              <button type="submit" className={`${btn} border border-border-strong bg-surface`}>Pembayaran simulasi (hanya uji)</button>
            </form>
          )}
          {!production && pending?.provider === "mock" && (
            <form action={mockSettleAction}>
              <input type="hidden" name="orderId" value={order.id} />
              <input type="hidden" name="paymentId" value={pending.id} />
              <button type="submit" className={`${btn} border border-border-strong bg-surface`}>Simulasikan pembayaran berhasil</button>
            </form>
          )}
        </section>
      )}
      <nav className="flex flex-wrap gap-3">
        {order.kind === "DEEP_REVIEW" && order.status === "PAID" && <Link className="inline-flex min-h-12 items-center underline" href="/reviews">Buka Legal Review Saya</Link>}
        {order.kind === "STANDARD_REVIEW" && order.status === "PAID" && <Link className="inline-flex min-h-12 items-center underline" href="/reviews">Buka Legal Review Saya</Link>}
        {order.kind.startsWith("MEMBERSHIP") && order.status === "PAID" && <Link className="inline-flex min-h-12 items-center underline" href="/dashboard">Kembali ke Beranda</Link>}
      </nav>
    </main>
  );
}

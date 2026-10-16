import Link from "next/link";
import { notFound } from "next/navigation";
import { OrderStatus } from "@/components/billing/order-status";
import { billingService } from "@/lib/billing/runtime";
import { CHECKOUT_NOTE } from "@/lib/copy";
import { requireUserId } from "@/lib/documents/session";
import { formatIdr } from "@/lib/pricing/catalog";
import { paymentReference } from "@/lib/reviews/paths";
import { mockSettleAction, payAction } from "../actions";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOTICE: Record<string, string> = { PROVIDER_UNAVAILABLE: "Metode pembayaran ini belum tersedia.", ORDER_NOT_PAYABLE: "Pesanan ini sudah tidak dapat dibayar." };
const LABEL: Record<string, string> = { MEMBERSHIP_MONTHLY: "Membership Yuktanya (1 periode)", MEMBERSHIP_ANNUAL: "Membership Yuktanya (1 tahun)", BUNDLE: "Paket kredit pemeriksaan", STANDARD_REVIEW: "Pemeriksaan Standar oleh pengacara" };
const btn = "min-h-12 rounded-lg px-5 font-semibold";

export default async function CheckoutPage({ params, searchParams }: { params: Promise<{ orderId: string }>; searchParams: Promise<{ notice?: string }> }) {
  const { orderId } = await params;
  const q = await searchParams;
  const userId = await requireUserId();
  if (!UUID.test(orderId)) notFound();
  const order = await billingService().getOrder(userId, orderId);
  if (!order) notFound();
  const pending = order.payments.find((p) => p.status === "PENDING");
  const manual = process.env.MANUAL_PAYMENT_INSTRUCTIONS?.trim() || "Instruksi pembayaran belum tersedia. Hubungi kami sebelum membayar.";
  const production = process.env.NODE_ENV === "production";
  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-3xl font-semibold">Pembayaran</h1>
      <section className="space-y-2 rounded-lg border border-slate-300 bg-white p-4">
        <h2 className="text-xl font-semibold">{LABEL[order.kind]}</h2>
        <p className="text-2xl font-semibold">{formatIdr(order.amountIdr)}</p>
        <p>{CHECKOUT_NOTE}</p>
      </section>
      {q.notice && NOTICE[q.notice] && <p role="alert" className="font-semibold text-red-800">{NOTICE[q.notice]}</p>}
      <OrderStatus order={order} />
      {order.status === "PENDING_PAYMENT" && (
        <section className="space-y-4" aria-label="Cara membayar">
          {pending?.provider === "manual" && (
            <div className="space-y-2 rounded-lg border border-slate-300 bg-white p-4">
              <h2 className="text-xl font-semibold">Transfer bank</h2>
              <p className="whitespace-pre-line">{manual}</p>
              <p>Tulis kode berikut pada berita transfer: <strong className="font-mono text-xl">{paymentReference(pending.id)}</strong></p>
              <p>Setelah transfer, kami mengonfirmasi pembayaran Anda secara manual. Mohon tunggu.</p>
            </div>
          )}
          {!pending && (
            <form action={payAction} className="space-y-3">
              <input type="hidden" name="orderId" value={order.id} />
              <input type="hidden" name="provider" value="manual" />
              <button type="submit" className={`${btn} bg-blue-600 text-white`}>Bayar dengan transfer bank</button>
            </form>
          )}
          {!production && !pending && (
            <form action={payAction}>
              <input type="hidden" name="orderId" value={order.id} />
              <input type="hidden" name="provider" value="mock" />
              <button type="submit" className={`${btn} border border-slate-400 bg-white`}>Pembayaran simulasi (hanya uji)</button>
            </form>
          )}
          {!production && pending?.provider === "mock" && (
            <form action={mockSettleAction}>
              <input type="hidden" name="orderId" value={order.id} />
              <input type="hidden" name="paymentId" value={pending.id} />
              <button type="submit" className={`${btn} border border-slate-400 bg-white`}>Simulasikan pembayaran berhasil</button>
            </form>
          )}
        </section>
      )}
      <nav className="flex flex-wrap gap-3">
        {order.kind === "STANDARD_REVIEW" && order.status === "PAID" && <Link className="inline-flex min-h-12 items-center underline" href="/reviews">Lihat Review Saya</Link>}
        {order.kind.startsWith("MEMBERSHIP") && order.status === "PAID" && <Link className="inline-flex min-h-12 items-center underline" href="/dashboard">Kembali ke beranda</Link>}
      </nav>
    </main>
  );
}

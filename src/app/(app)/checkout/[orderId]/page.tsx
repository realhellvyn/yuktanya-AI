import Link from "next/link";
import { notFound } from "next/navigation";
import { isPastDue, OrderStatus } from "@/components/billing/order-status";
import { PriceBreakdown } from "@/components/billing/price-breakdown";
import { PaymentOptions } from "@/components/billing/payment-options";
import { orderSubject } from "@/lib/billing/checkout-subject";
import { midtransConfig } from "@/lib/billing/midtrans";
import { getPool } from "@/lib/db";
import { billingService } from "@/lib/billing/runtime";
import { requireUserId } from "@/lib/documents/session";
import { mockSettleAction, payAction, refreshPaymentAction } from "../actions";
import { fixedText } from "@/lib/query-text";
import { EnhancedRubricNotice } from "@/components/deep/enhanced-availability";
import { deepService } from "@/lib/deep/runtime";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pembayaran | Yuktanya" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Status lunas TIDAK PERNAH dibaca dari alamat (Midtrans menambahkan parameter status ke URL kembali); hanya kode
// pemberitahuan tetap ini yang dipetakan ke kalimat, sisanya diabaikan.
const NOTICE: Record<string, string> = { PROVIDER_UNAVAILABLE: "Pembayaran belum tersedia. Silakan coba lagi nanti.",
  PROVIDER_ERROR: "Midtrans belum dapat dihubungi, sehingga pembayaran belum dibuat dan tidak ada uang yang ditarik. Coba lagi beberapa saat lagi.",
  STATUS_UNAVAILABLE: "Status pembayaran belum dapat diperiksa ke Midtrans. Coba lagi beberapa saat lagi.",
  RATE_LIMITED: "Anda baru saja memeriksa status. Tunggu satu menit, lalu coba lagi.",
  ORDER_EXPIRING: "Sisa waktu pembayaran pesanan ini kurang dari 2 menit, sehingga pembayaran tidak dapat dimulai. Tunggu beberapa menit sampai pesanan kedaluwarsa, lalu buat pesanan baru dari halaman dokumen atau halaman Membership.",
  ORDER_NOT_PAYABLE: "Pesanan ini sudah tidak dapat dibayar. Buat pesanan baru dari halaman dokumen atau halaman Membership.",
  SPECIAL_CASE_OPEN: "Dokumen ini sedang diajukan sebagai Special Legal Case, sehingga Legal Review belum dapat dibayar. Lihat statusnya di menu Special Legal Case, atau tarik pengajuan tersebut bila tidak jadi." };
const LABEL: Record<string, string> = { MEMBERSHIP_MONTHLY: "Membership Yuktanya (1 periode)", MEMBERSHIP_ANNUAL: "Membership Yuktanya (1 tahun)", BUNDLE: "Paket kredit Legal Review", STANDARD_REVIEW: "Legal Review oleh pengacara", DEEP_REVIEW: "Deep Review oleh pengacara (tambahan)" };
const INFO: Record<string, string> = { REFRESHED: "Status sudah diperiksa ulang ke Midtrans. Bila pembayaran belum tercatat, tunggu beberapa menit lalu periksa lagi." };

export default async function CheckoutPage({ params, searchParams }: { params: Promise<{ orderId: string }>; searchParams: Promise<{ notice?: string }> }) {
  const { orderId } = await params;
  const q = await searchParams;
  const userId = await requireUserId();
  if (!UUID.test(orderId)) notFound();
  const order = await billingService().getOrder(userId, orderId);
  if (!order) notFound();
  const manualText = process.env.MANUAL_PAYMENT_INSTRUCTIONS?.trim() || null;
  const subject = await orderSubject(getPool(), userId, order);
  const pastDue = isPastDue(order);
  const review = order.kind === "STANDARD_REVIEW" || order.kind === "DEEP_REVIEW";
  // Rincian Deep Review: beri tahu sebelum membayar bila Enhanced saat ini belum dapat terbit (rubrik belum disetujui).
  const rubricApproved = order.kind === "DEEP_REVIEW" ? await deepService().rubricApproved() : true;
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
          {order.kind === "DEEP_REVIEW" && <EnhancedRubricNotice rubricApproved={rubricApproved} />}
          <p><strong>Siapa yang memeriksa: </strong>profesional hukum dari firma mitra yang diberi wewenang oleh Yuktanya. AI tidak memberi persetujuan hukum.</p>
          <p><strong>Langkah berikutnya: </strong>setelah pembayaran dikonfirmasi, pengajuan Anda masuk antrean pemeriksaan. Pantau statusnya di menu Legal Review Saya.</p>
        </section>
      )}
      <PriceBreakdown service={LABEL[order.kind] ?? "Layanan Yuktanya"} quote={{ amountIdr: order.amountIdr, variant: order.variant ?? "", usesCredit: order.variant === "CREDIT" }} kind={order.kind} />
      {fixedText(NOTICE, q.notice) && <p role="alert" className="font-semibold text-danger">{fixedText(NOTICE, q.notice)}</p>}
      <OrderStatus order={order} />
      {fixedText(INFO, q.notice) && <p role="status" className="font-semibold">{fixedText(INFO, q.notice)}</p>}
      {order.status === "PENDING_PAYMENT" && !pastDue && (
        <PaymentOptions orderId={order.id} payments={order.payments} midtransAvailable={midtransConfig() !== null} production={production}
          manualText={manualText} payAction={payAction} refreshAction={refreshPaymentAction} mockSettleAction={mockSettleAction} />
      )}
      <nav className="flex flex-wrap gap-3">
        {order.kind === "DEEP_REVIEW" && order.status === "PAID" && <Link className="inline-flex min-h-12 items-center underline" href="/reviews">Buka Legal Review Saya</Link>}
        {order.kind === "STANDARD_REVIEW" && order.status === "PAID" && <Link className="inline-flex min-h-12 items-center underline" href="/reviews">Buka Legal Review Saya</Link>}
        {order.kind.startsWith("MEMBERSHIP") && order.status === "PAID" && <Link className="inline-flex min-h-12 items-center underline" href="/dashboard">Kembali ke Beranda</Link>}
      </nav>
    </main>
  );
}

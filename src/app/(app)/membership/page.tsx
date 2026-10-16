import { startMembershipAction } from "../checkout/actions";
import { formatIdr, PRICING, QUOTAS } from "@/lib/pricing/catalog";

export const dynamic = "force-dynamic";

export default function MembershipPage() {
  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-3xl font-semibold">Membership</h1>
      <section className="space-y-3 rounded-lg border border-slate-300 bg-white p-4">
        <p className="text-2xl font-semibold">{formatIdr(PRICING.membershipMonthlyIdr)} <span className="text-base font-normal">per periode tagihan</span></p>
        <ul className="list-disc space-y-1 pl-6">
          <li>{QUOTAS.MEMBER.messages} pesan AI per hari (non-member {QUOTAS.FREE.messages})</li>
          <li>{QUOTAS.MEMBER.documents} dokumen baru per hari (non-member {QUOTAS.FREE.documents})</li>
          <li>{QUOTAS.MEMBER.aiReviews} analisis awal AI per hari (non-member {QUOTAS.FREE.aiReviews})</li>
          <li>Pemeriksaan pengacara pertama pada setiap periode: {formatIdr(PRICING.standard.memberFirst)}; berikutnya {formatIdr(PRICING.standard.memberLater)} (non-member {formatIdr(PRICING.standard.free)})</li>
          <li>Berbagi dokumen, pengingat tenggat, dan paket bukti</li>
        </ul>
        <p>Membership bersifat pilihan. Anda tetap dapat memakai Yuktanya tanpa berlangganan.</p>
        <form action={startMembershipAction}>
          <button type="submit" className="min-h-12 rounded-lg bg-blue-600 px-5 font-semibold text-white">Lanjut ke pembayaran</button>
        </form>
      </section>
    </main>
  );
}

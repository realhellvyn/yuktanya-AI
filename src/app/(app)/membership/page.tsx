import { Button } from "@/components/ui/button";
import { Card, PageHeading } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { getMembershipState } from "@/lib/billing/membership";
import { getPool } from "@/lib/db";
import { formatDateId, wibDate } from "@/lib/documents/format";
import { requireUserId } from "@/lib/documents/session";
import { formatIdr, PRICING, QUOTAS } from "@/lib/pricing/catalog";
import { startMembershipAction } from "../checkout/actions";

export const dynamic = "force-dynamic";

export default async function MembershipPage() {
  const userId = await requireUserId();
  const m = await getMembershipState(getPool(), userId);
  return (
    <main className="max-w-3xl space-y-6">
      <PageHeading title="Membership" lead="Pilihan tambahan. Anda tetap dapat memakai Yuktanya tanpa berlangganan." />
      {m.active && (
        <Card className="space-y-2 border-green-300 bg-green-50">
          <div className="flex flex-wrap items-center gap-3"><h2 className="text-xl font-bold text-navy">Member Aktif</h2><StatusBadge tone="success">Aktif</StatusBadge></div>
          <p>Periode: {formatDateId(wibDate(m.periodStart))} – {formatDateId(wibDate(m.periodEnd))}</p>
          <p className="font-semibold">{m.firstReviewUsed ? `Pemeriksaan berikutnya: ${formatIdr(PRICING.standard.memberLater)}` : `Pemeriksaan pertama: ${formatIdr(PRICING.standard.memberFirst)}`}</p>
        </Card>
      )}
      <Card className="space-y-4">
        <p className="text-3xl font-bold text-navy">{formatIdr(PRICING.membershipMonthlyIdr)} <span className="text-base font-normal text-muted">per periode tagihan</span></p>
        <ul className="list-disc space-y-1.5 pl-6">
          <li>{QUOTAS.MEMBER.messages} pesan AI per hari (non-member {QUOTAS.FREE.messages})</li>
          <li>{QUOTAS.MEMBER.documents} dokumen baru per hari (non-member {QUOTAS.FREE.documents})</li>
          <li>{QUOTAS.MEMBER.aiReviews} analisis awal AI per hari (non-member {QUOTAS.FREE.aiReviews})</li>
          <li>Pemeriksaan pengacara pertama pada setiap periode: {formatIdr(PRICING.standard.memberFirst)}; berikutnya {formatIdr(PRICING.standard.memberLater)} (non-member {formatIdr(PRICING.standard.free)})</li>
          <li>Berbagi dokumen, pengingat tenggat, dan paket bukti</li>
        </ul>
        <form action={startMembershipAction}>
          <Button type="submit">{m.active ? "Perpanjang membership" : "Lanjut ke pembayaran"}</Button>
        </form>
      </Card>
    </main>
  );
}

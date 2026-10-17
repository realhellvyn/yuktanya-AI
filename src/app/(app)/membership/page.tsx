import { MembershipBenefits } from "@/components/billing/membership-benefits";
import { Button } from "@/components/ui/button";
import { Card, PageHeading } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { getMembershipState } from "@/lib/billing/membership";
import { getPool } from "@/lib/db";
import { formatDateId, wibDate } from "@/lib/documents/format";
import { requireUserId } from "@/lib/documents/session";
import { formatIdr, PRICING } from "@/lib/pricing/catalog";
import { startMembershipAction } from "../checkout/actions";

export const metadata = { title: "Membership | Yuktanya" };

export const dynamic = "force-dynamic";

export default async function MembershipPage() {
  const userId = await requireUserId();
  const m = await getMembershipState(getPool(), userId);
  return (
    <main className="max-w-3xl space-y-6">
      <PageHeading title="Membership" lead="Membership bersifat opsional. Anda tetap dapat memakai Yuktanya tanpa berlangganan." />
      {m.active && (
        <Card className="space-y-2 border-green-300 bg-green-50">
          <div className="flex flex-wrap items-center gap-3"><h2 className="text-xl font-bold text-navy">Member aktif</h2><StatusBadge tone="success">Aktif</StatusBadge></div>
          <p>Periode: {formatDateId(wibDate(m.periodStart))} – {formatDateId(wibDate(m.periodEnd))}</p>
          <p className="font-semibold">{m.firstReviewUsed ? `Legal Review berikutnya: ${formatIdr(PRICING.standard.memberLater)}` : `Legal Review pertama: ${formatIdr(PRICING.standard.memberFirst)}`}</p>
        </Card>
      )}
      <Card className="space-y-4">
        <p className="text-3xl font-bold text-navy">{formatIdr(PRICING.membershipMonthlyIdr)} <span className="text-base font-normal text-muted">per periode tagihan</span></p>
        <MembershipBenefits />
        <form action={startMembershipAction}>
          <Button type="submit">{m.active ? "Perpanjang Membership" : "Lanjut ke pembayaran"}</Button>
        </form>
      </Card>
    </main>
  );
}

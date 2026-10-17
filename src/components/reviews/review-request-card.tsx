import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { ActiveStandardReview } from "@/lib/billing/service";
import { formatIdr } from "@/lib/pricing/catalog";

type Props = {
  versionId: string;
  // Pesanan Legal Review aktif untuk versi ini (dari DB). Bila ada, harga tidak ditawarkan lagi.
  active: ActiveStandardReview | null;
  // Harga dari preview_price (server); null bila Legal Review tidak dapat diajukan untuk versi ini.
  quote: { amountIdr: number } | null;
  action: (formData: FormData) => Promise<void>;
};

// Kartu Legal Review di halaman dokumen. Status pesanan dan harga selalu dari server; kartu ini hanya memilih tampilan.
export function ReviewRequestCard({ versionId, active, quote, action }: Props) {
  if (active?.status === "PENDING_PAYMENT") {
    return (
      <Card className="space-y-3 border-line bg-tint">
        <p role="status">Legal Review untuk versi ini sudah dipesan dan sedang menunggu pembayaran.</p>
        <ButtonLink href={`/checkout/${active.orderId}`}>Lanjutkan pembayaran</ButtonLink>
      </Card>
    );
  }
  if (active?.status === "PAID") {
    return (
      <Card className="space-y-3 border-line bg-tint">
        <p role="status">Legal Review untuk versi ini sudah dibayar. Status dan hasilnya dapat dilihat di halaman Legal Review.</p>
        <ButtonLink href={active.requestId ? `/reviews/${active.requestId}` : "/reviews"} variant="secondary">Lihat Legal Review</ButtonLink>
      </Card>
    );
  }
  if (!quote) return null;
  return (
    <Card className="space-y-3 border-line bg-tint">
      <form action={action} className="space-y-3">
        <input type="hidden" name="versionId" value={versionId} />
        <p>Biaya Legal Review oleh pengacara untuk versi ini: <strong>{formatIdr(quote.amountIdr)}</strong>. Pembayaran adalah biaya pemeriksaan. Pembayaran tidak menjamin hasil positif.</p>
        <Button type="submit">Ajukan Legal Review</Button>
      </form>
    </Card>
  );
}

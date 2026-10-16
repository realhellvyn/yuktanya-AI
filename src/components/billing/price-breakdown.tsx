import { CHECKOUT_NOTE } from "@/lib/copy";
import { formatIdr, PRICING } from "@/lib/pricing/catalog";
import type { Quote } from "@/lib/billing/service";

const VARIANT_TEXT: Record<string, string> = {
  FREE: "Harga umum",
  MEMBER_FIRST: "Harga Member untuk pemeriksaan pertama pada periode ini",
  MEMBER_LATER: "Harga Member untuk pemeriksaan berikutnya pada periode ini",
  CREDIT: "Memakai kredit pemeriksaan Anda",
  DEFAULT: "Harga tetap",
};

export function PriceBreakdown({ service, quote }: { service: string; quote: Quote }) {
  return (
    <section aria-labelledby="harga-h" className="space-y-3 rounded-lg border border-slate-300 bg-white p-4">
      <h2 id="harga-h" className="text-xl font-semibold">Rincian biaya</h2>
      <dl className="space-y-2">
        <div><dt className="font-medium">Layanan</dt><dd>{service}</dd></div>
        <div><dt className="font-medium">Harga</dt><dd className="text-2xl font-semibold">{formatIdr(quote.amountIdr)}</dd></div>
        <div><dt className="font-medium">Keterangan</dt><dd>{VARIANT_TEXT[quote.variant] ?? quote.variant}</dd></div>
      </dl>
      <p>
        Member aktif membayar {formatIdr(PRICING.standard.memberFirst)} untuk pemeriksaan pertama pada setiap periode tagihan, lalu{" "}
        {formatIdr(PRICING.standard.memberLater)} untuk pemeriksaan berikutnya. Non-member membayar {formatIdr(PRICING.standard.free)}.
      </p>
      <p>{CHECKOUT_NOTE}</p>
    </section>
  );
}

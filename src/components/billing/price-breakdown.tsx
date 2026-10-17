import { CHECKOUT_NOTE } from "@/lib/copy";
import { formatIdr, PRICING } from "@/lib/pricing/catalog";
import type { Quote } from "@/lib/billing/service";

const VARIANT_TEXT: Record<string, string> = {
  FREE: "Harga akun gratis",
  MEMBER: "Harga Member aktif",
  MEMBER_FIRST: "Harga Member untuk Legal Review pertama dalam periode ini",
  MEMBER_LATER: "Harga Member untuk Legal Review berikutnya dalam periode ini",
  CREDIT: "Memakai kredit Legal Review Anda",
  DEFAULT: "Harga tetap",
};
export const AI_FREE_LAWYER_PAID = "AI gratis; Legal Review oleh pengacara berbayar.";

// Rincian biaya di halaman pembayaran: harga dari snapshot order (server), keterangan varian, dan aturan harga yang berlaku.
export function PriceBreakdown({ service, quote, kind = "STANDARD_REVIEW" }: { service: string; quote: Quote; kind?: string }) {
  return (
    <section aria-labelledby="harga-h" className="space-y-3 rounded-lg border border-line bg-surface p-4">
      <h2 id="harga-h" className="text-xl font-semibold">Rincian biaya</h2>
      <dl className="space-y-2">
        <div><dt className="font-medium">Layanan</dt><dd>{service}</dd></div>
        <div><dt className="font-medium">Harga</dt><dd className="text-2xl font-semibold">{formatIdr(quote.amountIdr)}</dd></div>
        <div><dt className="font-medium">Keterangan</dt><dd>{VARIANT_TEXT[quote.variant] ?? "Harga sesuai daftar harga"}</dd></div>
      </dl>
      {kind === "DEEP_REVIEW" ? (
        <p>
          Deep Review adalah biaya tambahan di luar Legal Review yang sudah dibayar: {formatIdr(PRICING.deepAdditional.free)} untuk
          akun gratis, {formatIdr(PRICING.deepAdditional.member)} untuk Member aktif.
        </p>
      ) : kind === "STANDARD_REVIEW" ? (
        <p>
          Member aktif membayar {formatIdr(PRICING.standard.memberFirst)} untuk Legal Review pertama dalam setiap periode tagihan, lalu{" "}
          {formatIdr(PRICING.standard.memberLater)} untuk Legal Review berikutnya. Akun gratis membayar {formatIdr(PRICING.standard.free)}.
          Membership {formatIdr(PRICING.membershipMonthlyIdr)} per periode tagihan dan bersifat opsional.
        </p>
      ) : null}
      <p className="font-semibold">{AI_FREE_LAWYER_PAID}</p>
      <p>{CHECKOUT_NOTE}</p>
    </section>
  );
}

import { CHECKOUT_NOTE } from "@/lib/copy";
import { formatIdr, PRICING } from "@/lib/pricing/catalog";
import type { Quote } from "@/lib/billing/service";

const VARIANT_TEXT: Record<string, string> = {
  FREE: "Harga umum",
  MEMBER: "Harga Member aktif",
  MEMBER_FIRST: "Harga Member untuk pemeriksaan pertama pada periode ini",
  MEMBER_LATER: "Harga Member untuk pemeriksaan berikutnya pada periode ini",
  CREDIT: "Memakai kredit pemeriksaan Anda",
  DEFAULT: "Harga tetap",
};
export const AI_FREE_LAWYER_PAID = "AI gratis; pemeriksaan pengacara berbayar.";

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
          Pemeriksaan mendalam adalah biaya tambahan di luar pemeriksaan standar yang sudah dibayar: {formatIdr(PRICING.deepAdditional.free)} untuk
          non-member, {formatIdr(PRICING.deepAdditional.member)} untuk Member aktif.
        </p>
      ) : kind === "STANDARD_REVIEW" ? (
        <p>
          Member aktif membayar {formatIdr(PRICING.standard.memberFirst)} untuk pemeriksaan pertama pada setiap periode tagihan, lalu{" "}
          {formatIdr(PRICING.standard.memberLater)} untuk pemeriksaan berikutnya. Non-member membayar {formatIdr(PRICING.standard.free)}.
          Membership {formatIdr(PRICING.membershipMonthlyIdr)} per periode tagihan dan tidak wajib.
        </p>
      ) : null}
      <p className="font-semibold">{AI_FREE_LAWYER_PAID}</p>
      <p>{CHECKOUT_NOTE}</p>
    </section>
  );
}

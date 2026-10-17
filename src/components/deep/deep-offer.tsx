import { CHECKOUT_NOTE, DEEP_PAYMENT_STATEMENT } from "@/lib/copy";
import { formatIdr, PRICING } from "@/lib/pricing/catalog";
import { fixedText } from "@/lib/query-text";

const REASON: Record<string, string> = {
  PARENT_NOT_COMPLETED: "Pemeriksaan standar belum selesai.",
  NO_ACTIONABLE_NOTES: "Pemeriksaan standar tidak memiliki catatan yang perlu ditindaklanjuti, jadi pemeriksaan mendalam tidak ditawarkan.",
  PARENT_NOT_ACTIVE: "Verifikasi pemeriksaan standar sudah tidak aktif.",
  VERSION_MISMATCH: "Isi versi tidak cocok dengan versi yang diperiksa.",
  DEEP_EXISTS: "Pemeriksaan mendalam untuk pemeriksaan ini sudah dipesan atau selesai.",
  SPECIAL_CASE_OPEN: "Dokumen ini sedang ditangani sebagai Kasus Hukum Khusus, jadi pemeriksaan mendalam tidak ditawarkan.",
};

type Props = { eligible: boolean; reason: string; quote: { amountIdr: number; variant: string } | null; action: (formData: FormData) => Promise<void>; parentRequestId: string; standardPaidIdr?: number };

// Tawaran hanya dirender oleh halaman bila fitur aktif. Tidak menjanjikan hasil Enhanced.
export function DeepOffer({ eligible, reason, quote, action, parentRequestId, standardPaidIdr }: Props) {
  if (!eligible || !quote) {
    return <p role="status" className="rounded-lg border border-line bg-surface p-4">{fixedText(REASON, reason) ?? "Pemeriksaan mendalam belum tersedia untuk pemeriksaan ini."}</p>;
  }
  const member = quote.variant === "MEMBER";
  return (
    <section aria-labelledby="deep-h" className="space-y-3 rounded-lg border border-line bg-surface p-4">
      <h2 id="deep-h" className="text-xl font-semibold">Pemeriksaan mendalam (tambahan)</h2>
      <p>Pemeriksaan tambahan oleh profesional hukum atas Legal Note (Catatan dari pemeriksa) yang sudah ditemukan, sebagai tambahan setelah pemeriksaan standar Anda. Tidak wajib.</p>
      <dl className="space-y-1">
        <div><dt className="font-medium">Biaya tambahan</dt><dd className="text-2xl font-semibold">{formatIdr(quote.amountIdr)}</dd></div>
        <div><dt className="font-medium">Keterangan</dt><dd>{member ? "Harga Member aktif" : `Harga umum. Member aktif membayar ${formatIdr(PRICING.deepAdditional.member)}.`}</dd></div>
        {standardPaidIdr !== undefined && <div><dt className="font-medium">Pemeriksaan standar yang sudah dibayar</dt><dd>{standardPaidIdr > 0 ? `${formatIdr(standardPaidIdr)} (dihitung terpisah)` : "Memakai kredit pemeriksaan (dihitung terpisah)"}</dd></div>}
        <div><dt className="font-medium">Total dibayar sekarang</dt><dd className="font-semibold">{formatIdr(quote.amountIdr)}</dd></div>
      </dl>
      <p>Membership ({formatIdr(PRICING.membershipMonthlyIdr)} per periode) adalah biaya terpisah dan tidak termasuk di sini.</p>
      <p>{CHECKOUT_NOTE}</p>
      <p className="font-semibold">{DEEP_PAYMENT_STATEMENT}</p>
      <p>Hasil pemeriksaan mendalam bisa berupa persetujuan Enhanced, selesai dengan catatan, belum dapat disimpulkan, atau dirujuk sebagai kasus khusus. Pembayaran tidak menjamin salah satunya.</p>
      <form action={action}>
        <input type="hidden" name="parentRequestId" value={parentRequestId} />
        <button type="submit" className="min-h-12 rounded-lg bg-primary hover:bg-primary-hover px-5 font-semibold text-on-primary">Lanjut ke pembayaran</button>
      </form>
    </section>
  );
}

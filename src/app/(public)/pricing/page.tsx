import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { CHECKOUT_NOTE, SPECIAL_CASE_NOTE } from "@/lib/copy";
import { PRICING, formatIdr } from "@/lib/pricing/catalog";

export const metadata = { title: "Harga | Yuktanya" };

const ROWS: { item: string; price: string; note?: string }[] = [
  { item: "Membuat dokumen dengan AI", price: "Gratis", note: "Dalam batas harian. Perlu daftar atau masuk." },
  { item: "Membership (opsional)", price: `${formatIdr(PRICING.membershipMonthlyIdr)} per periode`, note: "Kuota harian lebih besar dan harga pemeriksaan lebih rendah." },
  { item: "Pemeriksaan standar oleh pengacara (bukan member)", price: formatIdr(PRICING.standard.free) },
  { item: "Pemeriksaan standar, member aktif, yang pertama per periode", price: formatIdr(PRICING.standard.memberFirst) },
  { item: "Pemeriksaan standar, member aktif, berikutnya", price: formatIdr(PRICING.standard.memberLater) },
  {
    item: "Pemeriksaan mendalam (tambahan, bukan member)",
    price: formatIdr(PRICING.deepAdditional.free),
    note: "Hanya ditawarkan setelah pemeriksaan standar selesai dan memiliki Legal Note (Catatan dari pemeriksa) yang perlu ditindaklanjuti.",
  },
  { item: "Pemeriksaan mendalam (tambahan, member aktif)", price: formatIdr(PRICING.deepAdditional.member) },
  { item: "Kasus khusus", price: "Penawaran khusus", note: SPECIAL_CASE_NOTE },
];

export default function PricingPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl space-y-6 p-6">
        <h1 className="text-3xl font-semibold">Harga</h1>
        <table className="w-full border-collapse">
          <caption className="sr-only">Daftar harga layanan Yuktanya</caption>
          <thead>
            <tr className="border-b border-line text-left">
              <th scope="col" className="py-2 pr-4">Layanan</th>
              <th scope="col" className="py-2">Biaya</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.item} className="border-b border-slate-200 align-top">
                <th scope="row" className="py-3 pr-4 text-left font-normal">
                  {r.item}
                  {r.note && <span className="block text-slate-700">{r.note}</span>}
                </th>
                <td className="py-3 font-semibold">{r.price}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="rounded-lg border border-line bg-white p-4">{CHECKOUT_NOTE}</p>
      </main>
      <SiteFooter />
    </>
  );
}

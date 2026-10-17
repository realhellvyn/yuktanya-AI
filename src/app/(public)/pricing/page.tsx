import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { CHECKOUT_NOTE, SPECIAL_CASE_NOTE } from "@/lib/copy";
import { PRICING, formatIdr } from "@/lib/pricing/catalog";

export const metadata = { title: "Harga | Yuktanya" };

const ROWS: { item: string; price: string; note?: string }[] = [
  { item: "Pembuatan dokumen dengan AI", price: "Gratis", note: "Sesuai kuota harian. Anda perlu mendaftar atau masuk lebih dulu." },
  { item: "Membership (opsional)", price: `${formatIdr(PRICING.membershipMonthlyIdr)} per periode`, note: "Kuota harian lebih besar dan biaya Legal Review lebih rendah." },
  { item: "Legal Review oleh pengacara, akun gratis", price: formatIdr(PRICING.standard.free) },
  { item: "Legal Review, Member aktif, pertama dalam satu periode", price: formatIdr(PRICING.standard.memberFirst) },
  { item: "Legal Review, Member aktif, berikutnya", price: formatIdr(PRICING.standard.memberLater) },
  {
    item: "Deep Review (tambahan), akun gratis",
    price: formatIdr(PRICING.deepAdditional.free),
    note: "Hanya ditawarkan setelah Legal Review selesai dan memuat Legal Note (Catatan dari pemeriksa) yang perlu ditindaklanjuti.",
  },
  { item: "Deep Review (tambahan), Member aktif", price: formatIdr(PRICING.deepAdditional.member) },
  { item: "Kasus Hukum Khusus (Special Legal Case)", price: "Penawaran khusus", note: SPECIAL_CASE_NOTE },
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
              <tr key={r.item} className="border-b border-line align-top">
                <th scope="row" className="py-3 pr-4 text-left font-normal">
                  {r.item}
                  {r.note && <span className="block text-muted">{r.note}</span>}
                </th>
                <td className="py-3 font-semibold">{r.price}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="rounded-lg border border-line bg-surface p-4">{CHECKOUT_NOTE}</p>
      </main>
      <SiteFooter />
    </>
  );
}

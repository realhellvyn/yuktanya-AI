import { formatIdr, PRICING, QUOTAS } from "@/lib/pricing/catalog";

// Manfaat membership yang sudah berlaku di sistem dan sudah diputuskan pemilik. Fitur berbadan (berbagi, pengingat, paket bukti)
// yang dibatasi untuk Member masih USULAN (migrasi 0014), jadi tidak dijanjikan di sini sampai pemilik memutuskan.
export function MembershipBenefits() {
  return (
    <ul className="list-disc space-y-1.5 pl-6">
      <li>{QUOTAS.MEMBER.messages} pesan AI per hari (akun gratis: {QUOTAS.FREE.messages})</li>
      <li>{QUOTAS.MEMBER.documents} dokumen baru per hari (akun gratis: {QUOTAS.FREE.documents})</li>
      <li>{QUOTAS.MEMBER.aiReviews} analisis awal AI per hari (akun gratis: {QUOTAS.FREE.aiReviews})</li>
      <li>Legal Review pertama dalam setiap periode: {formatIdr(PRICING.standard.memberFirst)}; berikutnya {formatIdr(PRICING.standard.memberLater)} (akun gratis: {formatIdr(PRICING.standard.free)})</li>
    </ul>
  );
}

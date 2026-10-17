import { LegalPage, ul } from "@/components/legal-page";
import { AI_DRAFT_LABEL, AI_PREREVIEW_LABEL, CHECKOUT_NOTE, LEGAL_DISCLAIMER, SPECIAL_CASE_NOTE } from "@/lib/copy";
import { formatIdr, PRICING, QUOTAS } from "@/lib/pricing/catalog";

export const metadata = { title: "Syarat Penggunaan | Yuktanya" };

export default function Page() {
  return (
    <LegalPage
      title="Syarat Penggunaan"
      lead="Ringkasan aturan pemakaian Yuktanya sesuai cara kerja sistem saat ini."
      sections={[
        {
          id: "layanan",
          title: "Apa yang ditawarkan",
          body: (
            <>
              <p>Yuktanya membantu menyusun draf dokumen lewat percakapan dengan AI, lalu menyediakan Legal Review oleh profesional hukum mitra sebagai layanan opsional berbayar.</p>
              <p>{AI_DRAFT_LABEL}</p>
              <p>{AI_PREREVIEW_LABEL}</p>
            </>
          ),
        },
        {
          id: "akun",
          title: "Akun dan kuota harian",
          body: (
            <>
              <p>AI hanya dapat dipakai setelah Anda mendaftar dan masuk. Kuota harian diperbarui pukul 00.00 WIB.</p>
              <ul className={ul}>
                <li>Akun gratis: {QUOTAS.FREE.messages} pesan, {QUOTAS.FREE.documents} dokumen baru, dan {QUOTAS.FREE.aiReviews} analisis awal AI per hari.</li>
                <li>Member aktif ({formatIdr(PRICING.membershipMonthlyIdr)} per periode tagihan): {QUOTAS.MEMBER.messages} pesan, {QUOTAS.MEMBER.documents} dokumen baru, dan {QUOTAS.MEMBER.aiReviews} analisis awal AI per hari.</li>
                <li>Setiap analisis awal AI yang berhasil juga memakai satu pesan.</li>
              </ul>
            </>
          ),
        },
        {
          id: "pemeriksaan",
          title: "Legal Review dan Deep Review",
          body: (
            <>
              <p>Legal Review: {formatIdr(PRICING.standard.free)}. Member aktif membayar {formatIdr(PRICING.standard.memberFirst)} untuk Legal Review pertama dalam satu periode dan {formatIdr(PRICING.standard.memberLater)} untuk berikutnya.</p>
              <p>Deep Review hanya ditawarkan setelah Legal Review selesai dan memuat Legal Note (Catatan dari pemeriksa) yang perlu ditindaklanjuti. Biaya tambahannya {formatIdr(PRICING.deepAdditional.free)}, atau {formatIdr(PRICING.deepAdditional.member)} untuk Member aktif.</p>
              <p>{CHECKOUT_NOTE}</p>
              <p>{SPECIAL_CASE_NOTE}</p>
            </>
          ),
        },
        {
          id: "verifikasi",
          title: "Verifikasi dokumen",
          body: (
            <>
              <p>Lencana verifikasi hanya terbit setelah pemeriksa yang berwenang menyelesaikan pemeriksaan. Lencana berlaku untuk satu versi dokumen persis. Jika isi berubah, versi baru tidak mewarisi lencana dan harus diperiksa lagi.</p>
              <p>Verifikasi dapat dicabut. Halaman pengecekan publik selalu menampilkan status terbaru.</p>
              <p>{LEGAL_DISCLAIMER}</p>
            </>
          ),
        },
        {
          id: "batas",
          title: "Batas tanggung jawab dan pengembalian dana",
          body: <p>Aturan batas tanggung jawab, pembatalan, dan pengembalian dana belum ditetapkan. Bagian ini akan diisi setelah disetujui mitra hukum.</p>,
        },
      ]}
    />
  );
}

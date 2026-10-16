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
              <p>Yuktanya membantu menyusun draf dokumen lewat percakapan dengan AI, lalu menyediakan pemeriksaan oleh profesional hukum mitra sebagai pilihan berbayar.</p>
              <p>{AI_DRAFT_LABEL}</p>
              <p>{AI_PREREVIEW_LABEL}</p>
            </>
          ),
        },
        {
          id: "akun",
          title: "Akun dan batas harian",
          body: (
            <>
              <p>AI hanya dapat dipakai setelah mendaftar dan masuk. Batas harian di-reset pukul 00.00 WIB.</p>
              <ul className={ul}>
                <li>Akun gratis: {QUOTAS.FREE.messages} pesan, {QUOTAS.FREE.documents} dokumen baru, {QUOTAS.FREE.aiReviews} analisis awal AI per hari.</li>
                <li>Member aktif ({formatIdr(PRICING.membershipMonthlyIdr)} per periode tagihan): {QUOTAS.MEMBER.messages} pesan, {QUOTAS.MEMBER.documents} dokumen baru, {QUOTAS.MEMBER.aiReviews} analisis awal AI per hari.</li>
                <li>Setiap analisis awal AI yang berhasil juga memakai satu pesan.</li>
              </ul>
            </>
          ),
        },
        {
          id: "pemeriksaan",
          title: "Pemeriksaan oleh pengacara",
          body: (
            <>
              <p>Pemeriksaan standar: {formatIdr(PRICING.standard.free)}; untuk member aktif {formatIdr(PRICING.standard.memberFirst)} untuk yang pertama pada tiap periode dan {formatIdr(PRICING.standard.memberLater)} untuk berikutnya.</p>
              <p>Pemeriksaan mendalam hanya ditawarkan setelah pemeriksaan standar selesai dan memuat Legal Note (Catatan dari pemeriksa) yang perlu ditindaklanjuti. Tambahan biayanya {formatIdr(PRICING.deepAdditional.free)}, atau {formatIdr(PRICING.deepAdditional.member)} untuk member aktif.</p>
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

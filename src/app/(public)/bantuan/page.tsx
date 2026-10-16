import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { ButtonLink } from "@/components/ui/button";
import { Card, PageHeading } from "@/components/ui/card";
import { AI_DRAFT_LABEL, QR_NOT_SIGNATURE, SPECIAL_CASE_NOTE } from "@/lib/copy";
import { formatIdr, PRICING, QUOTAS } from "@/lib/pricing/catalog";
import { homeFor } from "@/lib/auth/permissions";
import { getSessionRoles } from "@/lib/supabase/server";

export const metadata = { title: "Bantuan | Yuktanya" };

const TOPICS: { id: string; title: string; body: React.ReactNode }[] = [
  {
    id: "buat",
    title: "Cara membuat dokumen",
    body: (
      <ol className="list-decimal space-y-1.5 pl-6">
        <li>Daftar atau masuk. AI hanya bisa dipakai setelah masuk.</li>
        <li>Tekan Buat Dokumen, lalu pilih jenis dokumen. Belum tahu dokumen mana yang cocok? Pilih &ldquo;Saya belum tahu&rdquo;, ceritakan keperluan Anda, dan AI membantu memilih.</li>
        <li>Jawab pertanyaan satu per satu dengan bahasa sehari-hari. Jawaban tersimpan otomatis.</li>
        <li>Saat semua terisi, tekan Buat dokumen. Anda bisa mengunduh dokumennya.</li>
      </ol>
    ),
  },
  {
    id: "batas",
    title: "Batas pemakaian harian",
    body: (
      <>
        <p>Batas di-reset setiap pukul 00.00 WIB.</p>
        <ul className="list-disc space-y-1.5 pl-6">
          <li>Gratis: {QUOTAS.FREE.messages} pesan, {QUOTAS.FREE.documents} dokumen baru, {QUOTAS.FREE.aiReviews} analisis awal AI.</li>
          <li>Member ({formatIdr(PRICING.membershipMonthlyIdr)} per periode tagihan): {QUOTAS.MEMBER.messages} pesan, {QUOTAS.MEMBER.documents} dokumen baru, {QUOTAS.MEMBER.aiReviews} analisis awal AI.</li>
          <li>Satu analisis awal AI yang berhasil juga memakai satu pesan.</li>
        </ul>
        <p>Jika batas habis, Anda tetap bisa membuka dan mengunduh dokumen yang sudah ada.</p>
      </>
    ),
  },
  {
    id: "pengacara",
    title: "Cara meminta pemeriksaan pengacara",
    body: (
      <>
        <ol className="list-decimal space-y-1.5 pl-6">
          <li>Buka dokumen Anda, lalu tekan Minta pemeriksaan pengacara.</li>
          <li>Periksa biaya, lalu bayar. Biaya standar {formatIdr(PRICING.standard.free)}; member aktif {formatIdr(PRICING.standard.memberFirst)} untuk yang pertama pada tiap periode, lalu {formatIdr(PRICING.standard.memberLater)}.</li>
          <li>Setelah pembayaran dikonfirmasi, pemeriksa dari mitra hukum mengerjakan pemeriksaan. Hasilnya muncul di Review Saya.</li>
        </ol>
        <p>Pembayaran adalah biaya pemeriksaan. Pembayaran tidak menjamin hasil tertentu.</p>
        <p>Hasil pemeriksaan dapat memuat Legal Note (Catatan dari pemeriksa): bagian dokumen yang menurut pengacara perlu diperbaiki atau diperhatikan, beserta saran tindakannya.</p>
        <p>Pemeriksaan mendalam (tambahan) hanya ditawarkan setelah pemeriksaan standar selesai dan memuat Legal Note yang perlu ditindaklanjuti. {SPECIAL_CASE_NOTE}</p>
      </>
    ),
  },
  {
    id: "cek",
    title: "Cara mengecek keaslian dokumen",
    body: (
      <>
        <p>Dokumen yang sudah diperiksa memuat kode QR dan kode verifikasi. Pindai QR atau buka tautan pengecekan yang tercetak di dokumen. Halaman itu menampilkan status terbaru: aktif, ditangguhkan, atau dicabut.</p>
        <p>Halaman itu juga menampilkan kode versi dokumen yang diperiksa. Cocokkan kode itu dengan kode versi yang tercetak di dokumen Anda. Jika berbeda, dokumen yang Anda pegang bukan versi yang diperiksa. Halaman pengecekan tidak membaca berkas Anda, jadi tidak dapat mendeteksi perubahan dengan sendirinya.</p>
        <p>{QR_NOT_SIGNATURE}</p>
      </>
    ),
  },
  {
    id: "ai",
    title: "Tentang AI",
    body: <p>{AI_DRAFT_LABEL} Jangan memasukkan data rahasia yang sungguhan selama masa uji ini.</p>,
  },
  {
    id: "akun",
    title: "Masalah akun",
    body: (
      <ul className="list-disc space-y-1.5 pl-6">
        <li>Lupa kata sandi: pakai Lupa kata sandi di halaman masuk.</li>
        <li>Email konfirmasi belum datang: periksa folder spam, lalu kirim ulang dari halaman masuk atau daftar.</li>
        <li>Unduh salinan data Anda atau hapus akun: masuk, lalu buka Pengaturan.</li>
      </ul>
    ),
  },
];

export default async function Page() {
  // Pengguna yang sudah masuk (dari menu aplikasi) mendapat tombol kembali ke aplikasinya, bukan "Masuk" / "Daftar Gratis".
  const session = await getSessionRoles().catch(() => null);
  const home = session ? homeFor(session.roles) : undefined;
  return (
    <>
      <SiteHeader home={home} />
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-8 md:px-8">
        <PageHeading title="Bantuan" lead="Jawaban singkat untuk pertanyaan yang paling sering muncul." />
        {TOPICS.map((t) => (
          <section key={t.id} aria-labelledby={t.id}>
            <Card className="space-y-3">
              <h2 id={t.id} className="text-xl font-bold text-navy">{t.title}</h2>
              {t.body}
            </Card>
          </section>
        ))}
        <section aria-labelledby="kontak">
          <Card className="space-y-2 border-amber-300 bg-amber-50">
            <h2 id="kontak" className="text-xl font-bold text-navy">Menghubungi kami</h2>
            <p>Saluran kontak belum disiapkan. Kami akan menampilkannya di halaman ini setelah tersedia.</p>
          </Card>
        </section>
        {home ? <ButtonLink href={home}>Kembali ke aplikasi</ButtonLink> : <ButtonLink href="/register">Daftar Gratis</ButtonLink>}
      </main>
      <SiteFooter />
    </>
  );
}

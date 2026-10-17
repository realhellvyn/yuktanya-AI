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
        <li>Daftar atau masuk. AI hanya dapat dipakai setelah Anda masuk.</li>
        <li>Tekan Buat Dokumen, lalu pilih jenis dokumen. Bila belum yakin, pilih &ldquo;Saya belum tahu&rdquo; dan ceritakan keperluan Anda. AI akan menyarankan dokumen yang sesuai.</li>
        <li>Jawab pertanyaan AI satu per satu dengan bahasa sehari-hari. Setiap jawaban tersimpan otomatis.</li>
        <li>Setelah semua isian lengkap, tekan Buat dokumen. Dokumen siap diunduh.</li>
      </ol>
    ),
  },
  {
    id: "batas",
    title: "Kuota harian",
    body: (
      <>
        <p>Kuota diperbarui setiap hari pukul 00.00 WIB.</p>
        <ul className="list-disc space-y-1.5 pl-6">
          <li>Gratis: {QUOTAS.FREE.messages} pesan, {QUOTAS.FREE.documents} dokumen baru, {QUOTAS.FREE.aiReviews} analisis awal AI.</li>
          <li>Member ({formatIdr(PRICING.membershipMonthlyIdr)} per periode tagihan): {QUOTAS.MEMBER.messages} pesan, {QUOTAS.MEMBER.documents} dokumen baru, {QUOTAS.MEMBER.aiReviews} analisis awal AI.</li>
          <li>Setiap analisis awal AI yang berhasil juga memakai satu pesan.</li>
        </ul>
        <p>Bila kuota habis, Anda tetap dapat membuka dan mengunduh dokumen yang sudah ada.</p>
      </>
    ),
  },
  {
    id: "pengacara",
    title: "Cara mengajukan Legal Review",
    body: (
      <>
        <ol className="list-decimal space-y-1.5 pl-6">
          <li>Buka dokumen Anda, lalu tekan Ajukan Legal Review.</li>
          <li>Periksa biayanya, lalu lakukan pembayaran. Biaya untuk akun gratis {formatIdr(PRICING.standard.free)}. Member aktif membayar {formatIdr(PRICING.standard.memberFirst)} untuk Legal Review pertama dalam setiap periode, lalu {formatIdr(PRICING.standard.memberLater)} untuk berikutnya.</li>
          <li>Setelah pembayaran dikonfirmasi, pengacara dari mitra hukum memeriksa dokumen Anda. Hasilnya tampil di Legal Review Saya.</li>
        </ol>
        <p>Pembayaran adalah biaya pemeriksaan. Pembayaran tidak menjamin hasil tertentu.</p>
        <p>Hasil pemeriksaan dapat memuat Legal Note (Catatan dari pemeriksa): bagian dokumen yang menurut pengacara perlu diperbaiki atau diperhatikan, beserta saran tindakannya.</p>
        <p>Deep Review adalah pemeriksaan tambahan. Deep Review hanya ditawarkan setelah Legal Review selesai dan memuat Legal Note yang perlu ditindaklanjuti.</p>
        <p>Kebutuhan hukum yang rumit dapat diajukan sebagai Kasus Hukum Khusus (Special Legal Case). {SPECIAL_CASE_NOTE}</p>
      </>
    ),
  },
  {
    id: "cek",
    title: "Cara mengecek keaslian dokumen",
    body: (
      <>
        <p>Dokumen yang sudah diperiksa memuat kode QR dan kode verifikasi. Pindai kode QR atau buka tautan pengecekan yang tercetak di dokumen. Halaman pengecekan menampilkan status terbaru: aktif, ditangguhkan, atau dicabut.</p>
        <p>Halaman pengecekan juga menampilkan kode versi dokumen yang diperiksa. Cocokkan kode tersebut dengan kode versi yang tercetak di dokumen Anda. Bila berbeda, dokumen yang Anda pegang bukan versi yang diperiksa. Halaman pengecekan tidak membaca berkas Anda, sehingga tidak dapat mendeteksi perubahan dengan sendirinya.</p>
        <p>{QR_NOT_SIGNATURE}</p>
      </>
    ),
  },
  {
    id: "ai",
    title: "Tentang AI",
    body: <p>{AI_DRAFT_LABEL} Selama masa uji coba, jangan memasukkan data rahasia yang sebenarnya.</p>,
  },
  {
    id: "akun",
    title: "Masalah akun",
    body: (
      <ul className="list-disc space-y-1.5 pl-6">
        <li>Lupa kata sandi: tekan Lupa kata sandi di halaman masuk.</li>
        <li>Email konfirmasi belum diterima: periksa folder spam, lalu kirim ulang dari halaman masuk atau halaman daftar.</li>
        <li>Unduh salinan data atau hapus akun: masuk, lalu buka Pengaturan.</li>
      </ul>
    ),
  },
];

export default async function Page() {
  // Pengguna yang sudah masuk (dari menu aplikasi) mendapat tombol kembali ke aplikasinya, bukan "Masuk" / "Daftar gratis".
  const session = await getSessionRoles().catch(() => null);
  const home = session ? homeFor(session.roles) : undefined;
  return (
    <>
      <SiteHeader home={home} />
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-8 md:px-8">
        <PageHeading title="Bantuan" lead="Jawaban singkat untuk pertanyaan yang paling sering diajukan." />
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
            <p>Saluran kontak belum tersedia. Informasi kontak akan ditampilkan di halaman ini setelah siap.</p>
          </Card>
        </section>
        {home ? <ButtonLink href={home}>Kembali ke aplikasi</ButtonLink> : <ButtonLink href="/register">Daftar gratis</ButtonLink>}
      </main>
      <SiteFooter />
    </>
  );
}

import { LegalPage, ul } from "@/components/legal-page";

export const metadata = { title: "Kebijakan Privasi | Yuktanya" };

export default function Page() {
  return (
    <LegalPage
      title="Kebijakan Privasi"
      lead="Data yang disimpan Yuktanya dan ke mana data dikirim, sesuai cara kerja sistem saat ini."
      sections={[
        {
          id: "data",
          title: "Data yang kami simpan",
          body: (
            <ul className={ul}>
              <li>Akun: email dan kata sandi (kata sandi dikelola layanan masuk, tidak kami simpan sebagai teks biasa).</li>
              <li>Dokumen: isi dokumen, setiap versinya, dan sidik jari digital (SHA-256) untuk mengecek apakah isinya berubah.</li>
              <li>Percakapan pengisian dokumen dan jawaban yang Anda ketik.</li>
              <li>Pemakaian harian (jumlah pesan, dokumen, dan analisis AI) untuk menerapkan kuota harian.</li>
              <li>Pesanan dan status pembayaran, permintaan Legal Review dan Deep Review, serta hasil pemeriksaan dan verifikasinya.</li>
              <li>Catatan kejadian (audit) untuk tindakan penting seperti penerbitan dan pencabutan verifikasi.</li>
              <li>Peristiwa penggunaan yang bersifat ringkas (nama kejadian, tanpa isi dokumen), disimpan di basis data.</li>
              <li>Sumber iklan, bila Anda datang lewat tautan iklan: disimpan sementara di cookie browser hingga 30 hari, lalu dicatat pada akun saat Anda mendaftar.</li>
            </ul>
          ),
        },
        {
          id: "ai",
          title: "Penggunaan AI",
          body: (
            <>
              <p>Percakapan pengisian dokumen dikirim dari server kami ke layanan AI (gerbang FreeLLMAPI). Hanya akun yang sudah masuk yang dapat memakai AI.</p>
              <p>Analisis awal AI atas dokumen hanya berjalan setelah Anda mencentang persetujuan pada layar analisis tersebut.</p>
              <p>Penyedia model di balik gerbang itu bisa memiliki aturan penyimpanan sendiri yang belum kami konfirmasi. Karena itu, selama masa uji coba, jangan memasukkan data rahasia yang sebenarnya. Gunakan data contoh.</p>
            </>
          ),
        },
        {
          id: "bagi",
          title: "Siapa yang dapat melihat data",
          body: (
            <ul className={ul}>
              <li>Dokumen Anda bersifat pribadi. Pengguna lain tidak dapat membukanya.</li>
              <li>Pemeriksa dari mitra hukum hanya dapat membuka dokumen yang ditugaskan kepadanya untuk pemeriksaan yang Anda minta.</li>
              <li>Tautan berbagi dibuat atas kehendak Anda, memiliki waktu kedaluwarsa, dan dapat Anda cabut.</li>
              <li>Halaman pengecekan verifikasi publik hanya menampilkan status, jenis, lingkup, dan sidik jari versi, tanpa isi dokumen.</li>
            </ul>
          ),
        },
        {
          id: "simpan",
          title: "Jangka waktu penyimpanan dan penghapusan",
          body: (
            <>
              <p>Jangka waktu penyimpanan resmi belum ditetapkan. Yang sudah berjalan di sistem saat ini:</p>
              <ul className={ul}>
                <li>Catatan percobaan pemakaian AI (untuk membatasi permintaan berlebihan) dihapus otomatis setelah 30 hari.</li>
                <li>Kode konfirmasi baca yang sudah kedaluwarsa dihapus otomatis setelah 7 hari.</li>
                <li>Di halaman Pengaturan Anda dapat mengunduh salinan data Anda (berkas JSON) dan menghapus akun.</li>
                <li>Saat akun dihapus, dokumen, percakapan, berkas, tautan berbagi, dan pengingat Anda dihapus. Catatan pesanan, pembayaran, dan audit tetap disimpan untuk pencocokan keuangan, tanpa terhubung lagi ke email Anda. Kode verifikasi yang sudah terbit tetap bisa dicek, tetapi isi dokumennya dikosongkan.</li>
              </ul>
              <p>Catatan verifikasi dan audit sengaja tidak dapat diubah agar riwayat tetap dapat dipercaya.</p>
            </>
          ),
        },
        {
          id: "kontak",
          title: "Pertanyaan tentang data Anda",
          body: <p>Saluran kontak resmi belum disiapkan. Lihat halaman Bantuan untuk informasi terbaru.</p>,
        },
      ]}
    />
  );
}

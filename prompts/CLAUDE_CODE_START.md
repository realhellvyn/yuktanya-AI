# Pesan pertama untuk Claude Code — v8

Bangun Yuktanya berdasarkan CLAUDE.md, README.md dan seluruh docs current v8. Audit v6/v7
bersifat historis. Jangan mengubah keputusan produk atau menganggap dokumen sebagai izin
deployment, pembayaran sungguhan, pengiriman pesan, atau pemakaian dokumen rahasia.

Mulai Phase 0 + 1 sesuai IMPLEMENTATION_GUIDE.md: Next.js strict TypeScript, Supabase
Auth/RLS, landing/pricing, login wajib sebelum AI, tiga dashboard shell yang benar-benar
terpisah izinnya, server-only FreeLLMAPI `model: "auto"`, mock mode dan kuota atomik WIB.
Free 20 pesan/1 dokumen/2 AI review per hari; Member aktif 60/5/10. Setiap AI review sukses
juga memakai satu pesan; gagal tidak mengurangi keduanya; internal retry idempotent.

Pertahankan semua harga standar/membership. Implementasi berikutnya harus memuat Legal
Verified standard dengan/tanpa Legal Note; Deep Review hanya sesudah standard selesai
dengan actionable Legal Notes, tambahan Free Rp200.000 / Member aktif Rp150.000; Enhanced
hanya sesudah pemeriksaan ekstra dan persetujuan profesional berwenang atas kriteria
material. Bayar tidak menjamin hasil positif. Baca DEEP_REVIEW.md, VERIFICATION_POLICY.md,
PARTNER_DASHBOARD.md dan PERMISSIONS.md untuk guard, immutable hash, QR, audit/revocation.

PENTING: jangan jalankan E2E setiap membuat atau mengubah sesuatu. Pilih pemeriksaan
berdasarkan dampak; unit/integrasi terarah untuk logika, E2E terpilih jika alur kritis berubah,
smoke menjelang rilis. Jangan mengulang seluruh suite yang sudah lulus tanpa alasan baru.
Skenario tetap disediakan di tests/e2e/SCENARIOS.md. Laporkan tes yang benar-benar dijalankan.

Jangan gunakan dokumen hukum sungguhan sebagai fixture, mengarang persetujuan template,
izin profesional, ketentuan gateway, atau hasil tes. Privacy/security/partner/hosting/payment
launch gates tetap berlaku. Gunakan synthetic prototype untuk blocker produksi yang belum
diputuskan. Setelah slice pertama berjalan, berikan cara lokal, hasil pemeriksaan terarah,
perubahan yang dibuat dan blocker konkret untuk slice berikutnya.

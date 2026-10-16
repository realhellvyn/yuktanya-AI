# Release checklist — prototipe sintetis → pilot terkendali

Dokumen ini mencatat apa yang sudah dibuktikan kode dan apa yang masih menjadi blocker non-kode. Tidak ada klaim bahwa aplikasi sudah disetujui secara hukum.

## Pemeriksaan teknis (jalankan sekali sebelum pilot/rilis, bukan setiap perubahan)
1. `npm run check` (lint, typecheck, unit, DB). 2. `npm run build`. 3. `npm run test:smoke` (E01, E02, E03, E08, E13, E14 ditambah E04, E05, E09, E10, E11). 4. `python3 -I scripts/validate_package.py`. 5. `grep -rniE "\bcap\b" src` hanya boleh menemukan komentar.
E2E browser, uji aksesibilitas manual (layar 320/375/390/1280, zoom 200%, keyboard), dan uji Supabase/Vercel nyata belum dijalankan; catat hasilnya terpisah saat dijalankan.

## Konfigurasi wajib sebelum pilot
- Supabase: proyek, bucket privat `documents`, Auth, migrasi `supabase/migrations/*`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`. Adapter Storage Supabase belum diverifikasi.
- `NEXT_PUBLIC_APP_URL` (URL kanonik untuk QR), `CRON_SECRET`, penjadwal yang memanggil `POST /api/jobs/outbox` dan menjalankan `expire_orders` (belum dijadwalkan).
- Penyedia email nyata (UNKNOWN; saat ini hanya mock) dan gateway pembayaran (UNKNOWN; saat ini hanya mock dan transfer manual). `MANUAL_PAYMENT_INSTRUCTIONS` harus diisi.
- Hosting produksi dan gateway LLM (`FREELLM_*`) belum ditetapkan.

## Flag produksi (semua default OFF)
`AI_PREREVIEW_ENABLED`, `DEEP_REVIEW_PURCHASE`, `ENHANCED_ISSUANCE`. Deep/Enhanced hanya dinyalakan setelah E04, E05, E09, E10, E11 lulus, rubrik M1–M7 disetujui mitra (`/admin/rubric`), dan kebijakan refund disepakati.

## Blocker non-kode (tidak diselesaikan oleh kode)
Persetujuan template oleh mitra hukum (`document_templates` harus `APPROVED` dengan hash cocok), kriteria dan rubrik hukum, klaim publik Legal Verified, kualifikasi/otorisasi profesional nyata, privasi dan persetujuan sebelum data nyata dikirim ke AI, penerbit/ruang lingkup publik (`PUBLIC_ISSUER_DISCLOSURE` tetap off), kebijakan refund/kredit, SLA, biaya AI dan mitra untuk margin, penilaian pajak dan entitas.

## Celah yang diketahui
Metrik AI hanya mencakup rute chat (bantuan isian dan analisis awal AI belum mengirim event); pekerjaan deep yang ditahan tetap berstatus ON_HOLD setelah refund/tutup; refund dan neto belum dipecah per jenis layanan; beberapa kasus smoke (E02 reviewer satu firma tak ditugaskan, E05 standar belum selesai, E10 catatan material belum selesai, E11 penugasan basi, E14 dokumen ke-6 Member, hash tidak cocok) belum punya kasus smoke tersendiri meski dicakup tes DB; Pembatas laju publik berada di memori per proses; unggahan PDF/DOCX belum ada; tidak ada jalur reinstate untuk verifikasi yang ditangguhkan; blok triase kasus khusus tidak punya sumber data; revoke oleh reviewer penerbit langsung (kebijakan menyebut hanya permintaan pencabutan).

## Status migrasi Supabase staging (proyek `yuktanya`, diterapkan 16 Okt 2026)
Migrasi 01–28 sudah diterapkan ke proyek staging lewat alat MCP, yang otomatis membatalkan pernyataan `DROP` dan `delete from`. Karena itu skema staging **berbeda sedikit** dari `supabase/migrations/*` di repo; perilaku yang dimaksud sama. Tidak ada data nyata di sana.
- Migrasi 05, 16, 17, 18, 22, 23 diterapkan dalam varian tanpa `DROP` (fungsi lama dibiarkan sebagai overload/pembungkus yang dicabut dari `anon`/`authenticated`). Nama migrasi di staging memakai akhiran (`_nodrop`, `_a1…_a5`).
- `ai_attempt_allowed` di staging **tidak menghapus** baris lama; retensi `ai_attempts` harus dijalankan pekerjaan terjadwal terpisah (belum ada).
- Fungsi `delete_note` (hapus catatan draf Legal Note) **belum ada** di staging karena memuat `delete from`. Terapkan manual lewat dashboard/CLI Supabase dari `20261016000021_report_publish.sql` sebelum reviewer memakai tombol hapus catatan.
- Advisor keamanan staging: tidak ada temuan dari skema aplikasi selain INFO "RLS tanpa kebijakan" (disengaja: default-deny, akses lewat fungsi service_role). `public.rls_auto_enable()` adalah fungsi bawaan platform, bukan bagian repo ini.
- Untuk produksi, terapkan berkas asli dengan Supabase CLI (`supabase db push`) pada proyek yang bersih, bukan varian ini.
- **Persetujuan template di staging bersifat sintetis.** Pada 16 Okt 2026 tiga baris `document_templates` (`pks`, `utang-piutang`, `nda`, versi 1) dimasukkan sebagai `APPROVED` dengan `approved_by` = akun pemilik proyek, hanya agar alur dokumen dapat diuji dengan data sintetis. Ini **bukan** persetujuan mitra hukum. Hapus baris itu (atau tandai `RETIRED`) sebelum pilot nyata dan ganti dengan persetujuan mitra atas hash template saat itu.

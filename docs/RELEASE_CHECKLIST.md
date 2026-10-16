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
Pembatas laju publik berada di memori per proses; unggahan PDF/DOCX belum ada; tidak ada jalur reinstate untuk verifikasi yang ditangguhkan; blok triase kasus khusus tidak punya sumber data; revoke oleh reviewer penerbit langsung (kebijakan menyebut hanya permintaan pencabutan).

# Runbook — retensi data, ekspor, penghapusan akun, dan pembayaran Midtrans

Status: **pengaturan awal rekayasa, menunggu persetujuan mitra hukum.** Angka retensi dan aturan simpan/hapus di bawah adalah perilaku sistem saat ini, bukan kebijakan hukum yang disetujui. Ubah lewat migrasi baru setelah ada keputusan.

Sumber kebenaran: `supabase/migrations/20261016000034_data_rights.sql` (fungsi `run_retention`, `export_account_data`, `account_erasure_blockers`, `erase_account`), `src/lib/retention/*`, tes `tests/db/data-rights.test.ts`, `tests/unit/data-rights.test.ts`, E2E `tests/e2e/journey-data-rights.mjs`.

## 1. Retensi terjadwal
- Endpoint: `GET|POST /api/jobs/retention`, autentikasi sama dengan job outbox: header `Authorization: Bearer $CRON_SECRET` (rahasia ≥ 16 karakter; tanpa rahasia → 503, salah → 401).
- Jadwal: `vercel.json` → `30 19 * * *` UTC (02.30 WIB setiap hari).
- Yang dihapus (idempoten, maksimal 5.000 baris per tabel per putaran, maksimal 10 putaran per panggilan; sisa → `more: true`, diselesaikan panggilan berikutnya):
  | Tabel | Aturan | Alasan aman |
  |---|---|---|
  | `ai_attempts` | `occurred_at` > 30 hari lalu | jendela pembatas laju terpanjang 24 jam |
  | `ack_challenges` | `expires_at` > 7 hari lalu | kode berlaku 10 menit; penguncian dihitung 24 jam; memuat email pihak ketiga |
  | `auth_attempts` | `window_start` > 2 hari lalu (migrasi 38) | jendela pembatas laju auth terpanjang 1 jam; hanya hash kunci, tanpa email/IP mentah |
- Sengaja **tidak** dihapus otomatis: `payment_events` (dedupe webhook), `outbox_events` (kunci dedupe mencegah kirim ganda), `ai_usage_reservations` (kuota & metrik), `product_events`/`audit_events` (tanpa isi dokumen; audit append-only), tautan bagikan kedaluwarsa (riwayat milik pengguna).
- Menjalankan manual: `curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/jobs/retention` atau SQL `select run_retention(now(), 5000);` (ulangi sampai `more = false`).

## 2. Ekspor data ("Unduh data saya")
- `/settings` → tombol **Unduh data saya** → `GET /settings/export` (hanya akun pemilik yang masuk). Kegagalan tidak pernah menjadi berkas: tanpa sesi → 303 ke `/login?returnTo=/settings`; staf/admin dialihkan proxy ke dashboard-nya; batas laju → 303 ke `/settings?notice=export-limit`; terlalu besar → `/settings?notice=export-large` (pesan tampil di Pengaturan). Tautan tidak memakai atribut `download`; unduhan dipicu `Content-Disposition` hanya pada respons sukses.
- Isi: profil, keanggotaan, dokumen + setiap versi (teks kanonik, SHA-256, isian), draf, percakapan, metadata unggahan, tautan bagikan (tanggal saja), kode verifikasi milik sendiri, pengingat, laporan analisis awal AI, pesanan + pembayaran, Review Standar (laporan FINAL & catatan PUBLISHED yang memang terlihat pemilik), status Pemeriksaan Mendalam, Kasus Hukum Khusus (ringkasan, penawaran, alasan tutup).
- Tidak pernah ikut: data pengguna lain, identitas reviewer/koordinator/firma/admin, laporan/catatan draf, kolom triase internal (`triaged_by`, `quoted_by`, `closed_by`), jalur penyimpanan, hash token tautan, kunci idempoten, alasan privat pencabutan.
- Batas: 5 unduhan per jam per akun (pembatas DB lintas instance, cakupan `account_export`, migrasi 41; gagal DB = ditolak); respons > 20 MB ditolak.

## 3. Penghapusan akun
Alur pengguna: `/settings` → **Hapus akun** → `/settings/hapus-akun` (daftar yang dihapus/disimpan, ketik `HAPUS`) → `/akun-dihapus` (publik). Draf pesan lokal di perangkat ikut dibersihkan.

Urutan teknis (`src/lib/retention/erasure.ts`):
1. `erase_account(user, now)` — satu transaksi, dikunci per akun, idempoten (`ALREADY_ERASED`).
2. Hapus berkas privat yang jalurnya dikembalikan (ekspor DOCX/PDF, paket bukti, berkas unggahan asli). Kegagalan dihitung, tidak membatalkan.
3. Hapus akun Auth lewat Supabase Admin API dengan **soft delete** (`auth.admin.deleteUser(id, true)`; butuh `SUPABASE_SERVICE_ROLE_KEY` di server). Identitas & login hilang; ID tetap ada sebagai rujukan anonim.
4. Cookie sesi dibersihkan. Karena semua peran dicabut di langkah 1, token yang tersisa tidak lagi membuka halaman terlindungi (`fetchSessionRoles` → tanpa peran = tidak masuk).

Ditolak (tidak ada yang berubah) bila, masing-masing dengan pesan dan langkah berikutnya sendiri di halaman konfirmasi:
- `STAFF_ACCOUNT` — peran reviewer/partner_admin/platform_admin, anggota firma, atau punya otorisasi profesional (offboarding lewat admin).
- `STANDARD_IN_PROGRESS` — Review Standar `QUEUED/ASSIGNED/IN_REVIEW`.
- `DEEP_IN_PROGRESS` — Pemeriksaan Mendalam `QUEUED/IN_REVIEW/READY_FOR_DECISION`, atau `ON_HOLD` selama pesanannya belum `CANCELLED` dan pembayarannya belum `REFUNDED` (deep yang ditahan lalu dikembalikan/ditutup admin tidak lagi menahan penghapusan).
- `SPECIAL_CASE_OPEN` — Kasus Hukum Khusus `SUBMITTED/TRIAGED/QUOTED/ACCEPTED`.
- `PAYMENT_RECONCILIATION` — pesanan `RECONCILIATION_REQUIRED` (admin menyelesaikan rekonsiliasi dulu).
- `PAYMENT_PENDING` — pesanan `PENDING_PAYMENT` yang belum lewat batas waktu bayar.

| Data | Perlakuan | Alasan |
|---|---|---|
| Dokumen tanpa jejak profesional (versi, draf, ekspor, unggahan) | dihapus | konten pribadi |
| Dokumen yang dirujuk Review Standar, Pemeriksaan Mendalam, atau verifikasi (termasuk AI) | baris & SHA-256 tetap; judul → "Dokumen dihapus pemilik", teks kanonik & isian dikosongkan, nama berkas unggahan → "dihapus", berkas dihapus | `/verify` pihak ketiga tetap bekerja; rujukan pesanan/review utuh |
| Percakapan, draf, tautan bagikan, konfirmasi baca & tantangannya (email penerima), pengingat, paket bukti, `ai_attempts` | dihapus | konten/jejak pribadi |
| Laporan analisis awal AI | dihapus; yang dirujuk verifikasi AI dikosongkan isinya | |
| Kasus Hukum Khusus (sudah selesai) | ringkasan diganti kalimat tetap; rujukan ke dokumen yang dihapus dikosongkan; penawaran & status tetap | catatan kerja firma |
| Laporan FINAL & catatan PUBLISHED reviewer | tetap, tidak diubah | karya profesional pihak ketiga; tak dapat diubah (trigger) |
| Pesanan, pembayaran, keanggotaan, kredit, `audit_events`, `product_events`, `ai_usage_reservations` | tetap | rekonsiliasi keuangan/pajak, audit; tanpa email |
| Profil | nama & UTM dikosongkan, `erased_at` diisi | penanda idempoten |
| Peran (`user_roles`) | dihapus | sesi lama tidak membuka apa pun |
| Antrean email (`outbox_events`) ke email pemilik | payload diganti `{"erased":true}`, yang belum terkirim dibatalkan | |
| Kejadian `ACCOUNT_ERASED` | ditambahkan ke `audit_events` (hanya jumlah) | jejak permintaan |

Gerbang kekekalan: trigger `forbid_immutable_change` (versi, ekspor, unggahan) hanya mengizinkan ubah/hapus di dalam transaksi `erase_account` (penanda `yuktanya.erasure` bernilai ID transaksi berjalan). Verifikasi, revokasi, laporan FINAL, catatan PUBLISHED, dan audit tidak pernah disentuh.

### Pemulihan bila langkah 2/3 gagal
- Pengguna diarahkan ke `/akun-dihapus?sebagian=1` (data sudah terhapus; login belum ditutup).
- Cari akun yang terhapus di DB tetapi Auth-nya belum: `select p.id from profiles p join auth.users u on u.id = p.id where p.erased_at is not null and u.deleted_at is null;` lalu hapus lewat Dashboard Supabase → Authentication → Users (atau Admin API `deleteUser(id, true)`).
- Berkas yang gagal dihapus tidak tercatat ulang (jalurnya sudah tidak ada di DB). Sapu manual: daftar objek bucket `documents` yang tidak dirujuk `document_exports`, `evidence_packs`, atau `document_uploads`. Belum ada pekerjaan otomatis.

### Celah yang diketahui
- Pembatas laju ekspor dan pembatas publik/billing berbasis DB (`rate_limit_hits`, migrasi 41); baris > 2 hari dibersihkan job retensi.
- Draf pesan percakapan disimpan di `localStorage` perangkat (maksimal 7 hari). Dibuang saat terkirim, saat menekan Keluar, saat akun lain membuka percakapan di perangkat yang sama (penanda pemilik draf), dan setelah akun dihapus. Sesi yang berakhir sendiri tanpa menekan Keluar meninggalkan draf sampai akun lain masuk atau 7 hari lewat.
- Permintaan pesanan baru yang berlangsung bersamaan dengan penghapusan tidak dikunci terhadap `erase_account`; jendela sangat kecil.

## 4. Pembayaran Midtrans (Task 21): refund manual, rekonsiliasi, rotasi kunci

Sumber kebenaran: `src/lib/billing/midtrans.ts` (klien Snap/Status, tanda tangan, pemetaan status), `src/lib/billing/handlers.ts` (`webhookHandler`), migrasi `20261016000039_midtrans.sql` (`create_hosted_payment`, `fail_payment`, `record_payment_event`, `settle_payment`), tes `tests/unit/midtrans.test.ts`, `tests/db/midtrans*.test.ts`, E2E `tests/e2e/journey-midtrans.mjs` (Midtrans palsu `tests/e2e/fake-midtrans.mjs`). Langkah Sandbox → Production ada di `docs/RELEASE_CHECKLIST.md` bagian "Midtrans".

Cara kerja singkat: `payments.provider_ref` = `order_id` di Midtrans (`ytk-<uuid>`). Pesanan lunas hanya lewat webhook `POST /api/payments/webhook/midtrans` atau tombol "Perbarui status" di checkout; keduanya memverifikasi ke Get Status API dengan server key, bukan dari badan notifikasi atau parameter URL. Notifikasi ganda/ulang aman (event idempoten per `transaction_id:status`). Notifikasi bertanda tangan sah untuk transaksi yang tidak dikenal API status dibalas 200 `UNKNOWN` (log `notifikasi Midtrans untuk transaksi yang tidak dikenal API status <order_id>`), tanpa perubahan data.

### 4.1 Refund manual (refund lewat API di luar cakupan)
1. Pastikan alasan refund sesuai kebijakan (kebijakan refund resmi masih UNKNOWN; catat keputusan siapa yang menyetujui).
2. Cari pembayaran: `select p.id, p.provider_ref, p.status, o.id as order_id, o.kind, o.status as order_status from payments p join orders o on o.id = p.order_id where p.provider = 'midtrans' and o.id = '<order_id>';`. `provider_ref` adalah Order ID di dashboard Midtrans.
3. Dashboard Midtrans (mode yang sesuai: Sandbox/Production) → Transactions → cari Order ID → Refund (penuh). Catat ID refund dari Midtrans.
4. Catat di Yuktanya:
   - Pesanan di daftar **Perlu rekonsiliasi** (`/admin/payments`, mis. jumlah tidak cocok, dana masuk setelah kedaluwarsa, atau pembayaran tambahan pada pesanan lunas): pilih "Catat pengembalian dana (dilakukan di luar sistem)" dan tulis catatan yang memuat ID refund Midtrans. Pembayaran menjadi `REFUNDED`; pesanan yang belum aktif menjadi `CANCELLED`.
   - Pesanan yang sudah `PAID` normal (tanpa pembayaran `DISPUTED`) belum punya tombol refund di admin. Jangan mengubah status lewat SQL tanpa keputusan pemilik: pemeriksaan/Membership yang sudah aktif tidak otomatis dicabut. Catat refund di luar sistem (tanggal, Order ID, ID refund Midtrans, admin) sampai ada fitur refund resmi.
5. Notifikasi `refund`/`partial_refund` dari Midtrans hanya dicatat sebagai event (`record_payment_event`); tidak mengubah status pembayaran atau pesanan. Pencatatan admin di langkah 4 tetap wajib.

### 4.2 Rekonsiliasi
- Daftar harian: `/admin/payments` → "Perlu rekonsiliasi". Sumber: `settle_payment` mengembalikan `AMOUNT_MISMATCH` (jumlah dari API ≠ jumlah pesanan) atau `RECONCILIATION_REQUIRED` (dana masuk setelah pesanan kedaluwarsa/dibatalkan, atau pesanan sudah lunas lewat transaksi lain).
- Bandingkan dengan dashboard Midtrans (Order ID = `provider_ref`). Dana terbukti diterima penuh → "Aktifkan pesanan"; selain itu refund (4.1).
- Pembayaran Midtrans yang masih `PENDING` padahal sudah dibayar (webhook gagal), atau `FAILED` (ditolak) lalu ternyata berhasil selama pesanan masih menunggu: minta pengguna menekan "Perbarui status", atau periksa `select p.provider_ref from payments p where p.provider = 'midtrans' and p.status = 'PENDING' and p.created_at < now() - interval '1 hour';` lalu cocokkan di dashboard. Pastikan Notification URL di dashboard benar (`https://yuktanya.com/api/payments/webhook/midtrans`).
- Log server `notifikasi Midtrans terkonfirmasi tanpa pembayaran Yuktanya <order_id>`: Midtrans mengenal transaksi `ytk-…` yang tidak ada di `payments` (mis. transaksi Snap dibuat tetapi DB menolak pembayaran karena pesanan berubah). Bila transaksi itu lunas di dashboard, refund lewat dashboard dan catat di luar sistem.
- Log `konfirmasi status Midtrans gagal UNAVAILABLE`: API status Midtrans tidak dapat dihubungi atau server key ditolak (401). Webhook membalas 503 sehingga Midtrans mengulang; periksa kunci dan status Midtrans.
- Notifikasi yang ditolak tanda tangannya (401) tidak pernah menyentuh database. Lonjakan 401 berarti ada yang menebak webhook, atau server key di Vercel tidak cocok dengan akun Midtrans pengirim (mis. kunci Sandbox dipasang saat dashboard di mode Production).

### 4.3 Rotasi server key
1. Dashboard Midtrans (mode yang sesuai) → Settings → Access Keys → buat/regenerasi server key. Kunci lama berhenti berlaku menurut aturan Midtrans; anggap segera.
2. Vercel → Project → Settings → Environment Variables → `MIDTRANS_SERVER_KEY` (Production, Sensitive) = kunci baru → redeploy. Kunci tidak pernah ditulis ke repo, log, atau tiket.
3. Selama jeda antara regenerasi dan redeploy: Snap menolak (checkout menampilkan "Midtrans belum dapat dihubungi … tidak ada uang yang ditarik"), dan webhook gagal verifikasi tanda tangan (401) atau konfirmasi status (503). Midtrans mengulang notifikasi yang gagal; setelah redeploy, minta pengguna yang terdampak menekan "Perbarui status" dan periksa daftar PENDING di 4.2.
4. Bila kunci diduga bocor: rotasi segera. Kunci bocor tidak cukup untuk melunasi pesanan tanpa transaksi nyata (setiap notifikasi dikonfirmasi ke API status), tetapi memungkinkan pemanggilan API Midtrans atas nama akun.


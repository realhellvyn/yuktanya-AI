# Runbook — retensi data, ekspor, dan penghapusan akun

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
- Sengaja **tidak** dihapus otomatis: `payment_events` (dedupe webhook), `outbox_events` (kunci dedupe mencegah kirim ganda), `ai_usage_reservations` (kuota & metrik), `product_events`/`audit_events` (tanpa isi dokumen; audit append-only), tautan bagikan kedaluwarsa (riwayat milik pengguna).
- Menjalankan manual: `curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/jobs/retention` atau SQL `select run_retention(now(), 5000);` (ulangi sampai `more = false`).

## 2. Ekspor data ("Unduh data saya")
- `/settings` → tombol **Unduh data saya** → `GET /settings/export` (hanya akun pemilik yang masuk). Kegagalan tidak pernah menjadi berkas: tanpa sesi → 303 ke `/login?returnTo=/settings`; staf/admin dialihkan proxy ke dashboard-nya; batas laju → 303 ke `/settings?notice=export-limit`; terlalu besar → `/settings?notice=export-large` (pesan tampil di Pengaturan). Tautan tidak memakai atribut `download`; unduhan dipicu `Content-Disposition` hanya pada respons sukses.
- Isi: profil, keanggotaan, dokumen + setiap versi (teks kanonik, SHA-256, isian), draf, percakapan, metadata unggahan, tautan bagikan (tanggal saja), kode verifikasi milik sendiri, pengingat, laporan analisis awal AI, pesanan + pembayaran, Review Standar (laporan FINAL & catatan PUBLISHED yang memang terlihat pemilik), status Pemeriksaan Mendalam, Kasus Hukum Khusus (ringkasan, penawaran, alasan tutup).
- Tidak pernah ikut: data pengguna lain, identitas reviewer/koordinator/firma/admin, laporan/catatan draf, kolom triase internal (`triaged_by`, `quoted_by`, `closed_by`), jalur penyimpanan, hash token tautan, kunci idempoten, alasan privat pencabutan.
- Batas: 5 unduhan per jam per akun (dalam memori per proses); respons > 20 MB ditolak.

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
- Pembatas laju ekspor ada di memori per proses (sama seperti pembatas publik lain).
- Draf pesan percakapan disimpan di `localStorage` perangkat (maksimal 7 hari). Dibuang saat terkirim, saat menekan Keluar, saat akun lain membuka percakapan di perangkat yang sama (penanda pemilik draf), dan setelah akun dihapus. Sesi yang berakhir sendiri tanpa menekan Keluar meninggalkan draf sampai akun lain masuk atau 7 hari lewat.
- Permintaan pesanan baru yang berlangsung bersamaan dengan penghapusan tidak dikunci terhadap `erase_account`; jendela sangat kecil.

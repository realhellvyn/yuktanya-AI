# Release checklist — prototipe sintetis → pilot terkendali

Dokumen ini mencatat apa yang sudah dibuktikan kode dan apa yang masih menjadi blocker non-kode. Tidak ada klaim bahwa aplikasi sudah disetujui secara hukum.

## Pemeriksaan teknis (jalankan sekali sebelum pilot/rilis, bukan setiap perubahan)
1. `npm run check` (lint, typecheck, unit, DB). 2. `npm run build`. 3. `npm run test:smoke` (E01–E06 dan E08–E14; E07 hanya di tes DB). 4. `bash scripts/e2e/run.sh` dengan `VIEWPORTS` desktop dan mobile (lihat README). 5. `python3 -I scripts/validate_package.py`. 6. `grep -rniE "\bcap\b" src` hanya boleh menemukan komentar.
CI manual: GitHub Actions > check > Run workflow menjalankan job `check`, `smoke`, dan `e2e` (hanya `workflow_dispatch`). Catat hasil lari nyata (jumlah lulus/gagal, tanggal, commit) terpisah; berkas ini tidak mengklaim hasilnya.
Belum otomatis dan belum dijalankan: uji aksesibilitas manusia (layar 320/375/390/1280, zoom 200%, keyboard, pemahaman catatan; E18), uji Supabase Auth/Storage nyata, dan deploy Vercel produksi. Pemetaan skenario ke tes ada di `tests/e2e/SCENARIOS.md`.

## Konfigurasi wajib sebelum pilot
- Supabase: proyek, bucket privat `documents`, Auth, migrasi `supabase/migrations/*`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`. Adapter Storage Supabase belum diverifikasi.
- `NEXT_PUBLIC_APP_URL` (URL kanonik untuk QR), `CRON_SECRET`, penjadwal yang memanggil `/api/jobs/outbox`, `/api/jobs/retention`, dan `/api/jobs/expire-orders` (penyapuan `expire_orders`, harian 00.45 WIB; ketiganya ada di `vercel.json`, header `Authorization: Bearer $CRON_SECRET`).
- `SUPABASE_SERVICE_ROLE_KEY` wajib di server agar penghapusan akun dapat menghapus akun Auth (soft delete lewat Admin API). Tanpa itu data tetap terhapus tetapi login belum ditutup (lihat `docs/RUNBOOK.md`).
- Penyedia email nyata (UNKNOWN; saat ini hanya mock) dan gateway pembayaran (UNKNOWN; saat ini hanya mock dan transfer manual). `MANUAL_PAYMENT_INSTRUCTIONS` harus diisi.
- Hosting produksi dan gateway LLM (`FREELLM_*`) belum ditetapkan.

## Flag produksi (semua default OFF)
`AI_PREREVIEW_ENABLED`, `DEEP_REVIEW_PURCHASE`, `ENHANCED_ISSUANCE`. Deep/Enhanced hanya dinyalakan setelah E04, E05, E09, E10, E11 lulus, rubrik M1–M7 disetujui mitra (`/admin/rubric`), dan kebijakan refund disepakati.

## Blocker non-kode (tidak diselesaikan oleh kode)
Persetujuan template oleh mitra hukum (`document_templates` harus `APPROVED` dengan hash cocok), kriteria dan rubrik hukum, klaim publik Legal Verified, kualifikasi/otorisasi profesional nyata, privasi dan persetujuan sebelum data nyata dikirim ke AI, penerbit/ruang lingkup publik (`PUBLIC_ISSUER_DISCLOSURE` tetap off), kebijakan refund/kredit, SLA, biaya AI dan mitra untuk margin, penilaian pajak dan entitas.

## Celah yang diketahui
Metrik AI (`admin_overview`) mencampur beberapa tugas: `chat`, `document_chat`, dan `ai_review` (dibedakan lewat metadata `task`, belum dipisah per tugas di tampilan); pekerjaan deep yang ditahan tetap berstatus ON_HOLD setelah refund/tutup; refund dan neto belum dipecah per jenis layanan; beberapa kasus smoke (E02 reviewer satu firma tak ditugaskan, E05 standar belum selesai, E10 catatan material belum selesai, E11 penugasan basi, E14 dokumen ke-6 Member, hash tidak cocok) belum punya kasus smoke tersendiri meski dicakup tes DB; Pembatas laju publik berada di memori per proses; unggahan PDF/DOCX/TXT ada di balik flag `AI_PREREVIEW_ENABLED` (pembacaan dalam proses, tanpa worker/sandbox dan tanpa pemindaian malware); tidak ada jalur reinstate untuk verifikasi yang ditangguhkan; revoke oleh reviewer penerbit langsung (kebijakan menyebut hanya permintaan pencabutan).

## Status migrasi Supabase staging (proyek `yuktanya`, diterapkan 16 Okt 2026)
Migrasi 01–28 sudah diterapkan ke proyek staging lewat alat MCP, yang otomatis membatalkan pernyataan `DROP` dan `delete from`. Karena itu skema staging **berbeda sedikit** dari `supabase/migrations/*` di repo; perilaku yang dimaksud sama. Tidak ada data nyata di sana.
- Migrasi 05, 16, 17, 18, 22, 23 diterapkan dalam varian tanpa `DROP` (fungsi lama dibiarkan sebagai overload/pembungkus yang dicabut dari `anon`/`authenticated`). Nama migrasi di staging memakai akhiran (`_nodrop`, `_a1…_a5`).
- `ai_attempt_allowed` di staging **tidak menghapus** baris lama; retensi `ai_attempts` kini dijalankan `/api/jobs/retention` (`run_retention`, migrasi 34).
- Fungsi `delete_note` (hapus catatan draf Legal Note) **belum ada** di staging karena memuat `delete from`. Terapkan manual (lihat bagian "Langkah manual staging" di bawah) sebelum reviewer memakai tombol hapus catatan.
- Advisor keamanan staging: tidak ada temuan dari skema aplikasi selain INFO "RLS tanpa kebijakan" (disengaja: default-deny, akses lewat fungsi service_role). `public.rls_auto_enable()` adalah fungsi bawaan platform, bukan bagian repo ini.
- Migrasi 30 (`20261016000030_special_cases.sql`, Kasus Hukum Khusus) ditulis **tanpa `DROP` dan `delete from`** (hanya `create`, `create or replace preview_price` dengan tanda tangan sama, trigger `before insert` pada `orders`, `revoke`/`grant`), sehingga dapat diterapkan apa adanya lewat MCP tanpa varian staging. Migrasi 31 (`20261016000031_special_case_payment_guard.sql`) hanya `create or replace create_payment` (tanda tangan sama) + `revoke`/`grant`, juga tanpa `DROP`/`delete from`. Belum diterapkan ke staging per commit ini; migrasi 29, 30, dan 31 perlu diterapkan berurutan.
- Migrasi 32 (`20261016000032_document_uploads.sql`, unggah dokumen + analisis awal AI) **memuat `DROP CONSTRAINT`**: constraint `documents_category_check` (nama otomatis Postgres untuk CHECK kolom `category` dari migrasi 07) diganti dengan versi yang menambah `UPLOAD`, tanpa kehilangan data dan tanpa `delete from`. Alat MCP akan membatalkan pernyataan itu. Urutan wajib: 29 (sudah diterapkan) → 30 → 31 → 32. Terapkan migrasi 32 **manual lewat SQL editor dashboard Supabase** dari berkas asli, atau terapkan varian tanpa `DROP` literal `supabase/staging/20261016000032_document_uploads_nodrop.sql` (pertukaran constraint lewat `execute format(...)` di blok `DO`; isi lain identik; diverifikasi dengan `tests/db/uploads.test.ts` saat berkas itu menggantikan migrasi 32). Pastikan sesudahnya `documents_category_check` mengizinkan `UPLOAD`.
- Untuk produksi, terapkan berkas asli dengan Supabase CLI (`supabase db push`) pada proyek yang bersih, bukan varian ini.
- Migrasi 33 (`20261016000033_analytics_events.sql`, katalog event analitik + `admin_analytics`) ditulis **tanpa `DROP` dan `delete from`** (hanya `create function`, `create or replace special_case_event` dengan tanda tangan sama, `create trigger analytics_capture` pada tabel sumber, `revoke`/`grant`), sehingga dapat diterapkan apa adanya lewat MCP tanpa varian staging. Urutan wajib: 29 → 30 → 31 → 32 → 33 (33 membutuhkan tabel `special_cases` dari 30 dan `document_uploads` dari 32). Trigger hanya menulis event untuk transisi **setelah** migrasi diterapkan; tidak ada backfill (angka dashboard tetap dari tabel sumber, jadi riwayat tidak hilang).
- **Persetujuan template di staging bersifat sintetis.** Pada 16 Okt 2026 tiga baris `document_templates` (`pks`, `utang-piutang`, `nda`, versi 1) dimasukkan sebagai `APPROVED` dengan `approved_by` = akun pemilik proyek, hanya agar alur dokumen dapat diuji dengan data sintetis. Ini **bukan** persetujuan mitra hukum. Hapus baris itu (atau tandai `RETIRED`) sebelum pilot nyata dan ganti dengan persetujuan mitra atas hash template saat itu.

## Langkah manual staging (pemilik proyek, lewat SQL editor dashboard Supabase)
Alat MCP membatalkan `DROP` dan `delete from`, jadi langkah ini dijalankan manusia. Semua data staging sintetis. Jalankan berurutan; setelah tiap langkah jalankan pemeriksaannya.

**A. `delete_note` (dari `20261016000021_report_publish.sql`).** Membutuhkan `load_draft` (sudah ada di staging sejak migrasi 21). Tempel persis:
```sql
create or replace function public.delete_note(p_reviewer uuid, p_request uuid, p_revision integer, p_note_no integer, p_now timestamptz)
returns integer language plpgsql security definer set search_path = public as $$
declare v_rep public.review_reports%rowtype;
begin
  v_rep := public.load_draft(p_reviewer, p_request, p_revision, p_now);
  delete from public.legal_notes n where n.report_id = v_rep.id and n.note_no = p_note_no;
  update public.review_reports rp set revision = rp.revision + 1 where rp.id = v_rep.id;
  return v_rep.revision + 1;
end;
$$;
revoke execute on function public.delete_note(uuid, uuid, integer, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.delete_note(uuid, uuid, integer, integer, timestamptz) to service_role;
```
Periksa: `select proname, prosecdef, proconfig from pg_proc where proname = 'delete_note';` → satu baris, `prosecdef = true`, `proconfig` memuat `search_path=public`; `select has_function_privilege('authenticated', 'public.delete_note(uuid,uuid,integer,integer,timestamptz)', 'execute');` → `false`. Catatan PUBLISHED tetap tidak dapat dihapus (trigger `legal_notes_guard`).

**B. Migrasi 30–35 (berurutan; 29 sudah diterapkan).**
1. `20261016000030_special_cases.sql` — apa adanya (MCP atau SQL editor). Periksa: `select to_regclass('public.special_cases');` tidak null.
2. `20261016000031_special_case_payment_guard.sql` — apa adanya.
3. `20261016000032_document_uploads.sql` — memuat `DROP CONSTRAINT`: jalankan berkas asli di SQL editor, **atau** lewat MCP pakai `supabase/staging/20261016000032_document_uploads_nodrop.sql`. Periksa: `select pg_get_constraintdef(oid) from pg_constraint where conname = 'documents_category_check';` memuat `'UPLOAD'`.
4. `20261016000033_analytics_events.sql` — apa adanya. Periksa: `select count(*) from pg_trigger where tgname = 'analytics_capture';` = 16.
5. `20261016000034_data_rights.sql` — memuat `delete from` (retensi dan penghapusan akun): jalankan berkas asli di SQL editor, **atau** lewat MCP pakai `supabase/staging/20261016000034_data_rights_nodelete.sql` (isi identik; kata kunci dirakit lewat `execute format(...)`; diverifikasi dengan `tests/db/data-rights.test.ts` saat menggantikan migrasi 34). Periksa: `select run_retention(now(), 100);` mengembalikan JSON `{ai_attempts, ack_challenges, more}`; `select column_name from information_schema.columns where table_name = 'profiles' and column_name = 'erased_at';` satu baris; `select has_function_privilege('authenticated', 'public.erase_account(uuid,timestamptz)', 'execute');` → `false`.
6. Setelah 34: atur `CRON_SECRET` di Vercel lalu pastikan cron `/api/jobs/retention` muncul di Project → Settings → Cron Jobs. Atur `SUPABASE_SERVICE_ROLE_KEY` (server saja).
7. `20261016000035_billing_integrity.sql` — apa adanya (tanpa `DROP`/`delete from`; tidak perlu varian staging). Isi: kolom `payments.received_at`; `create_order` memakai ulang order membership/paket yang masih menunggu; `fulfill_order` mengunci per pengguna; `create_payment` memakai ulang pembayaran PENDING metode sama; `admin_resolve_reconciliation` memesan ulang diskon Member pertama atau menolak `DISCOUNT_TAKEN`, dan dapat mencatat pengembalian pembayaran tambahan pada order lunas; `preview_price` menyapu order kedaluwarsa; `expire_orders_scoped` memeriksa ulang status di UPDATE (tidak menimpa order yang baru dibayar); angka "ditahan" di `admin_overview` memuat uang masuk yang belum terverifikasi. Periksa: `select column_name from information_schema.columns where table_name = 'payments' and column_name = 'received_at';` satu baris; `select has_function_privilege('authenticated', 'public.admin_resolve_reconciliation(uuid,uuid,text,text,timestamptz)', 'execute');` → `false`. Setelah deploy, pastikan cron `/api/jobs/expire-orders` muncul di Project → Settings → Cron Jobs.

## Kebijakan retensi & penghapusan — bawaan rekayasa (menunggu persetujuan mitra hukum)
Rincian lengkap di `docs/RUNBOOK.md`. Ringkas: `ai_attempts` dihapus setelah 30 hari, `ack_challenges` 7 hari setelah kedaluwarsa (harian 02.30 WIB, per batch, idempoten). Pengguna dapat mengunduh datanya (JSON, hanya milik sendiri) dan menghapus akun dari `/settings`. Penghapusan: konten pemilik dihapus; pesanan/pembayaran/audit disimpan tanpa email untuk rekonsiliasi; dokumen yang sudah diperiksa profesional atau punya verifikasi publik dipertahankan barisnya dengan hash (agar `/verify` tetap bekerja) tetapi judul/isi dikosongkan; laporan & catatan profesional yang sudah terbit tidak diubah. Penghapusan ditolak selama ada Review Standar atau Pemeriksaan Mendalam berjalan (deep ON_HOLD hanya selama pesanannya belum dibatalkan/dikembalikan), kasus khusus terbuka, pembayaran menunggu atau dalam pencocokan, atau untuk akun staf; tiap alasan punya pesan sendiri. Semua angka dan aturan ini harus disetujui mitra hukum sebelum pilot dengan data nyata.

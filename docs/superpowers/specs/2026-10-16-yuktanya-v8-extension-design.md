# Yuktanya v8 Extension — Katalog Hak, Pembayaran, dan Vault Aktif

Tanggal: 16 Oktober 2026 · Status: **DRAF, menunggu review pemilik** · Basis: blueprint v8 (commit baseline, tidak diubah)

## 1. Tujuan dan niat

Menyempurnakan Yuktanya v8 **tanpa mengecilkan scope**. Kompas, berurutan:
beda → dipercaya → murah tapi bagus → gampang.

Inti produk: alur terpadu dengan **dokumen sebagai pusat**. Vault berfungsi sebagai
"riwayat hidup" dokumen (draf, versi, review, catatan, verifikasi, QR), dibimbing langkah
demi langkah dengan bahasa ramah untuk pengguna awam dan orang tua.

Kriteria berhasil dari pemilik: banyaknya user daftar, review AI, review standar oleh
pengacara/praktisi hukum, dan review mendalam. Dihitung juga sebagai rasio antar tahap
(lihat §9). Target angka **[UNKNOWN]**, ditentukan setelah data pilot awal.

## 2. Hubungan dengan v8

- Semua keputusan terkunci v8 **tidak berubah**: harga (Rp19.000; Rp50.000/30.000/35.000;
  Deep Rp200.000/150.000), kuota (20/1/2 dan 60/5/10, reset 00.00 WIB), tiga dashboard,
  aturan Legal Verified/Enhanced, QR dan revocation, stack Next.js + Supabase, login sebelum
  AI, `model: "auto"`.
- Dokumen ini hanya **menambah**. Jika ada konflik, urutan otoritas di
  `docs/DECISIONS_AND_PRECEDENCE.md` berlaku, kecuali dinyatakan eksplisit di §10 (satu
  perubahan atas instruksi pemilik: cakupan smoke).
- Fitur Deep, Enhanced, dan QR/revocation tetap dibangun sesuai v8. Flag produksi
  `AI_PRE_REVIEW`, `DEEP_REVIEW_PURCHASE`, `ENHANCED_ISSUANCE` tetap default OFF.
- Struktur kepemilikan, aliran uang antar pihak, dan aspek etika profesi advokat berada di
  luar lingkup pembangunan sistem ini. Sistem dibuat netral terhadapnya (§5.4) dan statusnya
  dicatat sebagai **[UNKNOWN]** (§12).

### Glosarium istilah

| Istilah | Arti |
|---|---|
| "Cap" (istilah internal pemilik) | Tiga jenis catatan verifikasi: `AI` (Yuktanya AI Verified), `LEGAL` (Yuktanya Legal Verified, hasil Dengan/Tanpa Legal Note), `LEGAL_ENHANCED` (Yuktanya Legal Verified — Enhanced) |
| Teks ke pengguna | Pakai nama persis v8 atau kata "verifikasi". Kata "cap" tidak dipakai di UI/pemasaran sebelum disetujui partner, karena dapat terbaca sebagai stempel resmi (`VERIFICATION_POLICY.md`, `DESIGN_SYSTEM.md`) |
| Tanpa verifikasi | Review `INCONCLUSIVE`/`DECLINED`/`INCOMPLETE`, dan setiap versi yang diedit setelah diperiksa |

## 3. Arsitektur tambahan

Semua dalam modular monolith v8. Cross-row invariant dijaga transaksi/RPC Supabase.

| Modul | Fungsi |
|---|---|
| Katalog produk dan hak | Produk memberi hak: kuota, slot diskon, kunci fitur |
| Kunci fitur Vault | `vault.reminders`, `vault.share`, `vault.evidence_pack`, `vault.amend` |
| Adapter pembayaran | Mock, transfer manual, gateway (Midtrans atau Xendit) |
| Share dan konfirmasi baca | Link terikat satu versi, baca saja |
| Paket bukti | Snapshot dengan manifest dan hash |
| Versi baru dan diff | Versi tanpa warisan badge, diff deterministik |
| Pengingat | Dari field tanggal template, opt-in |

Usulan lokasi kode: `src/lib/entitlements/`, `src/lib/billing/adapters/`,
`src/lib/vault/{share,evidence,amend,reminders}.ts`. Usulan, bukan file yang sudah ada.

## 4. Katalog produk dan hak

**Prinsip:** Free, Member, tahunan, dan bundle adalah **data**, bukan kode.

- Tabel `products` (Member bulanan, Member tahunan, bundle review, dan seterusnya) dan
  `product_grants` (kuota, slot diskon, kunci fitur).
- Nilai terkunci v8 menjadi data awal (seed). Server satu-satunya penentu hak. Order
  pending tidak memberi hak.
- Kunci fitur Vault dipetakan ke plan lewat konfigurasi. Hanya `platform_admin` dengan
  capability khusus yang dapat mengubah, dan setiap perubahan masuk audit. Default
  pemetaan Free vs Member **belum diputuskan**; pembangunan tidak menunggunya.
- Harga baru (tahunan, bundle) **[UNKNOWN]**; diisi pemilik sebagai data, bukan kode.

### 4.1 Paket tahunan
Dipecah internal menjadi **12 slot bulanan**. Tiap slot memiliki hak diskon "review
pertama" sendiri, sehingga aturan v8 (Rp30.000 untuk review standar pertama per periode,
Rp35.000 berikutnya, tanpa carry-over) tetap berlaku utuh per slot. Kuota harian mengikuti
status Member aktif.

### 4.2 Bundle review
Kredit review dengan masa berlaku. **Tidak ditumpuk** dengan diskon review pertama:
satu review memakai kredit **atau** harga normal/diskon, tidak keduanya. Kredit
dicadangkan atomik saat order dan dilepas saat gagal atau kedaluwarsa. **Asumsi (belum
dikonfirmasi pemilik):** kredit hanya untuk review standar yang memenuhi syarat; Deep
Review tetap mengikuti aturan v8 dan tidak memakai kredit.

### 4.3 Harga layanan review (keputusan pemilik, 16 Oktober 2026)
Harga review **hanya** yang terkunci di v8, tanpa jenis review berbayar baru:

| Layanan | Biaya |
|---|---|
| Review standar | Free Rp50.000; Member pertama per periode Rp30.000, berikutnya Rp35.000 |
| Review mendalam (Deep) | Tambahan Rp200.000 (Free) / Rp150.000 (Member aktif), hanya setelah standar selesai dengan Legal Note actionable |
| Total standar + Deep | Free Rp250.000; Member Rp180.000 (standar pertama) / Rp185.000 (berikutnya); Rp19.000 membership tidak termasuk |
| Special Legal Case | Penawaran khusus setelah asesmen |

Bundle dan paket tahunan hanya mengubah **cara membayar/mendapat hak** atas review di atas,
bukan menambah jenis review baru.

### 4.4 Perpanjangan membership
Default **manual**: pengingat menjelang habis, lalu bayar sekali klik. **Auto-debit
opsional**, dipilih user sendiri dengan persetujuan eksplisit, dan hanya jika penyedia
mendukung. Dashboard admin hanya memakai istilah "MRR" ketika auto-debit aktif
(sesuai `ADMIN_DASHBOARD.md`).

## 5. Pembayaran

### 5.1 Alur satu transaksi
1. **Quote → order.** Harga dihitung di server dari katalog; `idempotency_key` unik per user.
2. **Reservasi hak** (slot diskon atau kredit bundle) selama pembayaran menunggu.
3. **Buat tagihan** di gateway lewat adapter. Metode bayar yang tersedia bergantung pada
   penyedia dan akun merchant **[UNKNOWN]**.
4. **Callback:** verifikasi tanda tangan, lalu **cek ulang status ke API gateway**. Payload
   callback saja tidak dipercaya. Redirect browser dan screenshot bukan bukti.
5. **Satu transaksi database:** payment `VERIFIED` → konsumsi reservasi → hak diberikan atau
   review diantrikan → event dan audit ditulis (outbox). Callback ganda tidak menghasilkan
   efek ganda (kunci idempotensi `provider + provider_ref/event_id`).
6. **Gagal/kedaluwarsa:** reservasi dilepas otomatis.

Status payment: PENDING, VERIFIED, FAILED, EXPIRED, REFUNDED, DISPUTED (sesuai v8).
Pembayaran terlambat setelah order batal/kedaluwarsa menghasilkan
`PAYMENT_RECONCILIATION_REQUIRED`, tanpa aktivasi otomatis.

### 5.2 Adapter
Satu antarmuka, tiga implementasi: **mock** (pengembangan/tes), **manual** (transfer plus
konfirmasi admin, dari v8 Fase 4), **gateway**. Penyedia dapat diganti tanpa mengubah logika
bisnis. Pilihan Midtrans vs Xendit, tarif per transaksi, dukungan debit berulang, dan
syarat persetujuan merchant **[UNKNOWN]** dan harus dicek langsung ke penyedia.

### 5.3 Pencatatan
- Biaya gateway dicatat per payment (`fee_idr`) agar margin dashboard admin dapat dihitung.
- Rekonsiliasi harian: settlement gateway vs tabel payment; selisih masuk antrean
  rekonsiliasi.
- Refund tercatat sebagai entitas sendiri dan membalik hak yang diberikan. Aturan refund
  **[UNKNOWN]** dan menjadi konfigurasi.
- Kolom pajak/faktur (nullable) disiapkan; aturan pajak tidak disentuh.

### 5.4 Netralitas struktur uang
Pembayaran dicatat sebagai order dan payment biasa. Pembagian ke pihak lain (jika ada)
adalah ledger terpisah dan opsional, sehingga sistem tidak bergantung pada skema
kepemilikan yang belum diputuskan.

## 6. Vault aktif

Tiap fitur dikunci oleh kunci fitur (§4). Semua tabel baru default-deny di RLS dan tidak
menyimpan isi dokumen di log.

### 6.1 Berbagi dengan pihak lawan (`vault.share`)
- Link berbagi terikat **satu versi** (id versi dan SHA-256), baca saja, token acak tak
  dapat ditebak, masa berlaku, dapat dicabut pemilik dan berlaku langsung.
- Sebelum dibuat, pemilik melihat peringatan: siapa pun yang punya link dapat membaca.
- **Pihak lawan membaca tanpa akun.** Halaman baca menampilkan status verifikasi terkini
  (aktif, dicabut, versi lama) dan ajakan "Buat dokumen sendiri, gratis".
- Bila pemilik membuat versi baru, link lama tetap menunjuk versi lama dan hanya
  menampilkan "Ada versi yang lebih baru", tanpa bocor isi.
- **Konfirmasi baca** (opsional): pihak lawan menekan "Saya sudah membaca versi ini" setelah
  **verifikasi email**. Tercatat waktu dan email terverifikasi. Label wajib: **bukan tanda
  tangan elektronik**. Redaksi final perlu persetujuan partner **[UNKNOWN]**.

### 6.2 Paket bukti sengketa (`vault.evidence_pack`)
Snapshot server-side untuk satu versi atau dokumen. Isi: riwayat versi dengan hash dan
waktu; laporan review dan Legal Note yang terlihat user (**catatan kerja profesional privat
tidak ikut**); catatan verifikasi dan status QR; log berbagi dan konfirmasi baca; manifest
berisi SHA-256 tiap berkas serta hash paket. Dibuat sebagai job latar belakang dengan rate
limit; disimpan privat; diunduh lewat signed URL berumur pendek. Pernyataan wajib: kumpulan
catatan sistem, **bukan jaminan nilai pembuktian di pengadilan**. Redaksi final
**[UNKNOWN]**.

### 6.3 Versi baru dan diff (`vault.amend`)
- "Buat versi baru dari versi ini" menyalin data terstruktur ke versi baru pada dokumen yang
  sama. Tidak memakai jatah dokumen harian (sesuai v8: pembaruan versi tidak mengonsumsi
  kuota dokumen) dan **tidak mewarisi badge** apa pun.
- Diff per klausul dihitung deterministik dari data terstruktur, tanpa AI.
- Diff hanya alat bantu tampilan (untuk user dan reviewer). **Tidak ada jenis review
  berbayar baru**: versi yang diedit setelah diperiksa dikenai **review standar baru**
  dengan harga normal v8 (§4.3).

### 6.4 Pengingat (`vault.reminders`)
Field tanggal di skema template (jatuh tempo, akhir masa NDA, akhir kerja sama) ditandai
"dapat diingatkan". User memilih sendiri (opt-in), misalnya 30/7/1 hari sebelum. Kanal awal
email, lewat outbox yang sama dengan QR/notifikasi (tidak terkirim ganda). WhatsApp
dipertimbangkan nanti, butuh persetujuan pengguna dan **[UNKNOWN]** penyedia/biaya.

## 7. Pertumbuhan dan iklan

- Sumber pendaftaran (UTM, kampanye, kreatif) **wajib dicatat** di profil dan
  `product_events`; di v8 sebelumnya "jika tersedia".
- Event pembelian ditulis dari sisi server dengan nilai dan sumber kampanye. **Isi dokumen
  dan data pribadi tidak dikirim** ke platform iklan. Konversi server-ke-server ke platform
  iklan adalah keputusan terpisah di kemudian hari.
- Optimasi iklan bertahap: pendaftaran → draf selesai → pembayaran, sesuai volume data.
- Kebijakan iklan platform untuk layanan hukum dan aturan promosi layanan hukum
  **[UNKNOWN]**, harus dicek sebelum iklan tayang.
- Angka platform iklan dibandingkan dengan angka internal; keputusan memakai angka internal.
- Halaman baca berbagi dan halaman verifikasi punya ajakan "Buat dokumen sendiri, gratis".

## 8. Model data tambahan (konsep, bukan migrasi)

`products`, `product_grants`, `entitlement_ledger` (tahunan: 12 slot; bundle: kredit),
`feature_plan_map`, `share_links`, `share_access_events`, `acknowledgements`,
`evidence_packs`, `reminders`, `payment_adapter_events`. Tambahan kolom: `payments.fee_idr`,
`orders.tax_idr` (nullable), `profiles`/`product_events` untuk atribusi sumber.

Invarian: uang dalam integer IDR; satu `idempotency_key` per user; unik
`(provider, provider_ref)`; konsumsi slot/kredit hanya dalam transaksi settlement;
`share_links` selalu merujuk versi tak berubah; tidak ada UPDATE klien langsung ke hak,
harga, atau pemetaan fitur. SQL migrasi dibuat dan diuji di lingkungan implementasi.

## 9. Metrik dan dashboard admin

Tambahan pada `ADMIN_DASHBOARD.md`:
- **Metrik utama pemilik:** user daftar, review AI, review standar, review mendalam.
- **Rasio:** daftar → pakai AI → minta review standar → minta review mendalam, dengan
  denominator dan label kohort. Zero denominator ditampilkan N/A.
- **Margin** dihitung dari `fee_idr` dan biaya yang tercatat; data yang belum ada tetap N/A.
  Pembagian ke pihak lain hanya masuk jika ledger terpisah (§5.4) diaktifkan.
- **Vault:** link berbagi dibuat/dibuka, konfirmasi baca, paket bukti, versi baru, pengingat
  terkirim. Hanya ID aman, tanpa isi.
- **Akuisisi:** funnel per sumber kampanye.
- Perpanjangan manual bukan MRR.

Seperti v8: Enhanced rate bukan target penjualan; admin tidak dapat mengubah kesimpulan
profesional.

## 10. Strategi tes

Mengikuti `docs/TEST_STRATEGY.md` (berbasis dampak; tanpa E2E per perubahan), dengan
**satu perubahan atas instruksi pemilik: cakupan smoke dipersempit menjadi 6 skenario**.
Ini menggantikan daftar smoke v8 (E01–E06, E08–E14) dan dicatat sebagai keputusan pemilik.

**Smoke rilis (otomatis, hanya sebelum rilis/pilot):**
E01 (login sebelum AI), E02 (izin peran), E03 (review standar), E08 (settlement
pembayaran), E13 (lookup QR/revocation), E14 (kuota).

**Penjagaan:** sebelum flag `DEEP_REVIEW_PURCHASE` atau `ENHANCED_ISSUANCE` dinyalakan di
produksi, E04–E05 dan E09–E11 wajib ditambahkan ke smoke. E08 dijalankan terhadap adapter
yang aktif; E19 dijalankan saat adapter gateway diubah/ditambah.

**Katalog (tambahan E19–E28, dijalankan per dampak, bukan otomatis):**

| ID | Tag | Yang diuji |
|---|---|---|
| E19 | billing | Callback gateway: tanda tangan salah, ganda, terlambat |
| E20 | billing | Tahunan: slot bulanan, reset tiap bulan, tanpa dobel saat bersamaan |
| E21 | billing | Kredit bundle: terpakai, kedaluwarsa, tidak ditumpuk dengan diskon pertama |
| E22 | billing | Perpanjangan manual: pengingat → bayar → periode baru |
| E23 | vault | Link berbagi: terikat versi, kedaluwarsa, cabut langsung, tanpa bocor isi |
| E24 | vault | Konfirmasi baca: verifikasi email, label bukan tanda tangan |
| E25 | vault | Paket bukti: tanpa catatan privat, manifest/hash benar, otorisasi |
| E26 | vault | Versi baru: tanpa warisan badge, diff, tanpa kuota dokumen |
| E27 | vault | Pengingat: opt-in dan tidak terkirim ganda |
| E28 | entitlement | Ubah pemetaan fitur: teraudit dan hanya admin |

Total katalog 28 (18 dari v8 + 10). Permutasi harga/slot/kredit/kuota/batas WIB diuji di
unit dan integrasi, bukan browser. Vektor tes uang ditambahkan ke
`tests/policy-vectors.json` saat implementasi. Skenario di atas adalah **spesifikasi**,
belum ada yang dijalankan. Waktu jalan **[UNKNOWN]**.

**Penjaga kuota CI (GitHub Actions):** pengalaman pemilik menunjukkan E2E/smoke yang terlalu
sering menghabiskan menit gratis. Aturan: unit dan integrasi jalan di PR dengan filter path;
smoke 6 skenario hanya lewat pemicu manual atau tag rilis; E2E katalog hanya lewat
pemicu manual per tag; `concurrency` dengan `cancel-in-progress` agar run lama dibatalkan;
cache dependensi dan browser Playwright; tidak ada run terjadwal otomatis untuk E2E. Sisa
kuota akun **[UNKNOWN]** dan dicek pemilik di Settings → Billing and plans → Usage.

**Keputusan pemilik (16 Oktober 2026):** sampai kuota Actions reset (sekitar 1 November
2026), workflow di repo ini hanya memakai `workflow_dispatch` (manual); tidak ada pemicu
otomatis di push/PR. Pemeriksaan harian dijalankan lokal lewat satu perintah
`npm run check` (lint, typecheck, unit/integrasi) dan hasilnya dilaporkan apa adanya. Setelah
reset, CI ringan di PR (hanya unit/integrasi dengan filter path) dinyalakan setelah menit per
run diukur. Kondisi kuota saat ini (≈95% jatah 2.000 menit terpakai pada 16 Oktober 2026,
per tangkapan layar pemilik) adalah data akun, bukan jaminan.

## 11. Penanganan kegagalan

Gateway AI mati: input tersimpan. Callback ganda: idempoten. Pembayaran kedaluwarsa:
reservasi dilepas. Selisih rekonsiliasi: antrean. Link dicabut: efek langsung. Job paket
bukti gagal: dapat diulang tanpa duplikat. Tidak ada kegagalan yang boleh tampil sebagai
"tersimpan" atau "selesai".

## 12. Urutan bangun dan UNKNOWN

**Urutan (bukan pemotongan):** fase v8 tetap. Katalog dan kuota di Fase 1; adapter
pembayaran (mock dulu) mengikuti Fase 4; kunci fitur Vault dibangun setelah versi dan hash
Fase 2 berdiri; Deep, Enhanced, QR/revocation sesuai peta v8.

**UNKNOWN (dicatat, tidak menghambat kode sintetis):**
- Tarif, metode bayar, dan dukungan debit berulang Midtrans/Xendit; syarat merchant.
- Harga tahunan dan bundle; default pemetaan Free vs Member untuk kunci fitur.
- Jumlah putaran revisi yang termasuk dalam biaya, aturan Deep berulang, dan kredit/refund
  bila temuan masih ada (tidak dihargai terpisah; mengikuti open questions v8).
- Redaksi final: pernyataan paket bukti, label konfirmasi baca.
- Aturan refund dan masa berlaku kredit.
- Struktur kepemilikan dan aliran uang antar pihak; aspek etika profesi advokat.
- Kebijakan iklan platform dan aturan promosi layanan hukum.
- Sign-off partner atas semua butir v8 (template, rubrik M1–M7, scope, dan seterusnya).
- Ekspor berbadge: tata letak blok verifikasi di dokumen; apakah DOCX (dapat diedit) ikut
  berbadge atau hanya PDF (usulan: hanya PDF); apakah stempel/tanda tangan profesional
  dicantumkan (terpisah di v8, butuh kewenangan dan engagement).
- Jangkauan privasi jalur drafting (chat wawancara mengirim nama/nominal ke upstream):
  gate produksi untuk jalur ini perlu keputusan; prototype tetap sintetis.

## 13. Di luar lingkup

Kode aplikasi, migrasi SQL, integrasi gateway nyata, e-sign/e-meterai, WhatsApp, produk
UMKM/tim (kandidat fase berikutnya), pemeriksa pihak ketiga berbayar (perlu validasi
permintaan dulu). Tidak ada deployment atau pembayaran sungguhan.

## 14. Kriteria penerimaan spec

1. Semua keputusan terkunci v8 tidak berubah (diperiksa terhadap `policy-vectors.json`).
2. Tahunan: tiap slot bulanan memberi satu diskon review pertama; tidak ada dobel pada
   transaksi bersamaan.
3. Bundle tidak pernah ditumpuk dengan diskon review pertama.
4. Hak hanya diberikan setelah payment `VERIFIED` oleh settlement terverifikasi.
5. Link berbagi tidak pernah menampilkan versi selain yang diikat; pencabutan langsung.
6. Versi baru tidak mewarisi badge dan dikenai review standar baru dengan harga v8.
7. Paket bukti tidak memuat catatan privat profesional.
8. Smoke rilis = 6 skenario di §10, dengan penjagaan flag Deep/Enhanced.

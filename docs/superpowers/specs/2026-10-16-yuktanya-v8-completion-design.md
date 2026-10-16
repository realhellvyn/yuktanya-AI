# Yuktanya v8 — Penyelesaian Penuh dan Pembuatan Dokumen Full-AI

Tanggal: 16 Oktober 2026 · Status: **disetujui sesuai instruksi pemilik "perbaiki semua, tanpa izin"** · Basis: blueprint v8 + `docs/superpowers/specs/2026-10-16-yuktanya-v8-extension-design.md`

## 1. Niat pemilik (ditulis ulang untuk dikoreksi)

Yang dikatakan pemilik:
- V8 lengkap harus benar-benar ada dan **terbukti berjalan**, bukan hanya lulus tes fungsi database.
- Tambahan dari asisten yang sudah dijanjikan juga harus terbangun.
- **Pembuatan dokumen full-AI, tanpa form manual.**
- Dikerjakan dengan alur superpowers; pemilik sudah lelah menguji satu per satu, jadi pembuktian harus otomatis.

Asumsi asisten (koreksi bila salah):
- "Tanpa manual" berarti tidak ada layar isian kolom satu per satu untuk membuat dokumen. Koreksi jawaban dilakukan lewat percakapan.
- AI **tidak** menulis klausul bebas. Isi klausul tetap dari template yang disetujui mitra hukum dan dirender deterministik. AI mewawancarai, mengekstrak fakta, dan hanya mengisi nilai yang benar-benar diucapkan pengguna (aturan V8: AI tidak boleh mengarang nama, jumlah, tanggal, fakta).
- Gateway FreeLLMAPI sudah dikonfigurasi pemilik; tes browser memakai LLM palsu pada jalur gateway yang sama.

## 2. Keputusan (Ruling) yang diambil asisten

| # | Keputusan | Alasan | Biaya bila salah |
|---|---|---|---|
| R1 | Wizard manual per kolom **dihapus**; diganti percakapan AI tersimpan di DB | Permintaan eksplisit pemilik | Saat AI/gateway mati pembuatan dokumen tertahan; percakapan tersimpan dan bisa dilanjutkan |
| R2 | Klausul tetap dari template deterministik; AI tidak menulis klausul | V8 `PRODUCT_SPEC.md`: template wajib disetujui mitra, AI tidak boleh mengarang | Dokumen kurang "kreatif"; tidak ada risiko hukum tambahan |
| R3 | Nilai yang diterapkan ke draf harus lolos pemeriksaan "tertulis di ucapan pengguna" (grounding) pada gabungan seluruh pesan pengguna | Mencegah kolom karangan model | Kadang kolom valid ditolak; AI bertanya ulang |
| R4 | Satu pesan pengguna = 1 pesan AI dari kuota (kuota V8 tetap) | Aturan kuota terkunci | Percakapan panjang menghabiskan 20 pesan Free; AI diminta mengisi banyak kolom per pesan |
| R5 | Koreksi nilai dilakukan lewat percakapan ("ganti nama pihak kedua jadi…"); ringkasan hanya baca | Tanpa form manual | Koreksi bergantung AI memahami; nilai tetap divalidasi |
| R6 | Fitur dengan gerbang non-kode (upload+analisis AI, Enhanced, Deep) tetap di balik flag default OFF, tetapi **UI dan jalurnya dibangun dan diuji** | CLAUDE.md: gerbang privasi/hukum tetap | Tidak ada; flag menyalakan |
| R7 | Teks `/privacy` dan `/terms` memuat kerangka faktual dari perilaku sistem dan menandai bagian hukum **"menunggu persetujuan mitra hukum"**; tidak mengarang kebijakan | Spec melarang kebijakan karangan | Halaman belum final untuk publik |
| R8 | Event produk lengkap (19 event V8) ditulis server-side dengan dedupe; metrik admin tetap dihitung dari tabel sumber, event dipakai untuk tren dan audit | Menjaga angka benar sambil memenuhi spec | Dua sumber data harus konsisten; ada tes rekonsiliasi |
| R9 | Pembuktian "berjalan" = tes browser otomatis (`scripts/e2e/run.sh`) mencakup setiap alur kritis dengan akun pengguna, reviewer, koordinator, dan admin | Pemilik tidak mau menguji manual | Tes memakai Auth palsu; Auth Supabase asli hanya diuji lewat smoke produksi |

## 3. Dekomposisi (urutan eksekusi; tiap sub-proyek: tes dulu → implementasi → tes browser → review)

**A. Pembuatan dokumen full-AI (percakapan).** Tabel `document_messages`; giliran percakapan server-side (kuota, limiter, idempoten, grounding, JSON tervalidasi, perbaikan JSON); UI percakapan + pratinjau langsung + ringkasan baca-saja + tombol Buat dokumen; hapus wizard manual dan rute `step`. Kegagalan AI tidak menghilangkan pesan; kuota dilepas.
**B. Pembuktian alur peran lewat tes browser.** Fake Auth mendukung akun admin/reviewer/koordinator; skenario E01–E14: daftar → dokumen → pesan → versi → review berbayar (transfer manual dikonfirmasi admin) → penugasan koordinator → reviewer menulis Legal Note dan menerbitkan → verifikasi publik `/verify` dan QR → pencabutan → Deep Review (flag ON di tes) sampai Enhanced → admin melihat metrik.
**C. Layar V8 yang belum ada.** `/partner` penuh (antrean, penampil dokumen+versi+hash, editor catatan, pratinjau hasil, modal finalisasi), `/partner/team`, `/partner/approvals`, `/partner/cases`; `/reviews/[id]/deep` dan `/deep-reviews/[id]`; `/settings` (ekspor dan penghapusan akun/data), `/privacy`, `/terms`, `/design-preview`; lupa kata sandi dan kirim ulang konfirmasi; "Saya belum tahu" (jenis dokumen lewat percakapan); Bantuan.
**D. Upload dan analisis awal AI.** Unggah PDF/DOCX/TXT (validasi isi+ekstensi+ukuran), parser terisolasi, persetujuan eksplisit, hasil dikelompokkan sesuai `WIREFRAMES.md` §8, kuota review AI, AI Verified. Flag `AI_PREREVIEW_ENABLED` default OFF; tes memakai flag ON.
**E. Kasus Khusus.** Intake, triase, penawaran khusus (`quote_sent`, `quote_accepted`), partner `/partner/cases`, tidak bisa membeli review standar otomatis.
**F. Admin penuh.** Tren harian, pembanding periode sebelumnya, filter jenis dokumen/membership, rentang kustom, panel kualitas, peringatan di dashboard; 19 event produk.
**G. Keandalan.** Retensi `ai_attempts`, ekspor/penghapusan data pengguna, autosave percakapan, offline/timeouts, job terjadwal, `delete_note` di staging, catatan runbook.

## 4. Kriteria penerimaan global

1. `npm run check` hijau; `bash scripts/e2e/run.sh` hijau di desktop dan HP; setiap sub-proyek menambah skenario E2E miliknya.
2. Tidak ada rute spec V8 yang 404; tidak ada tautan mati di navigasi.
3. Tidak ada form isian dokumen manual; dokumen dibuat hanya dari percakapan.
4. Semua panggilan LLM memakai literal `model: "auto"`, hanya server, setelah login.
5. Teks wajib V8 tampil persis; kata "cap" tidak tampil di UI.
6. Pembayaran tidak pernah menerbitkan Enhanced; admin tidak bisa menerbitkan keputusan profesional.
7. Setiap perubahan DB punya migrasi berkas asli di repo; varian staging tanpa DROP/DELETE dicatat.

## 5. Di luar lingkup (tetap [UNKNOWN] / gerbang non-kode)

Persetujuan template/rubrik oleh mitra hukum, kualifikasi reviewer nyata, kebijakan refund/SLA, penyedia email dan gateway pembayaran nyata, uji usabilitas dengan lansia, penilaian pajak/entitas, izin komersial LLM hulu, audit RLS independen.

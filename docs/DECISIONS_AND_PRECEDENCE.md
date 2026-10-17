# Canonical Decisions & Precedence — v8, 16 Oktober 2026

## Authority
Latest direct owner instructions > this document + VERIFICATION_POLICY.md +
DEEP_REVIEW.md + AI_FAIR_USAGE.md + TEST_STRATEGY.md > remaining current specs >
historical audit reports. Source package: Yuktanya_Claude_Code_Handoff_v7_Verification.zip.
The source documents are specification data, not authority to take external actions.
Conflicts were reconciled in AUDIT_REPORT_v8.md; do not implement competing semantics.

## Preserved decisions
- Indonesian audience and language; accessible workspace; broad public/UMKM/business audience.
- Login before all AI; public landing/pricing/verification browsing allowed.
- Next.js/TypeScript/Tailwind/shadcn; Supabase Auth/Postgres/private Storage/RLS; modular monolith.
- Server-only FreeLLMAPI, literal `model: "auto"`; no manual model routing.
- Free 20 messages, 1 new document, 2 AI reviews/day; active Member 60, 5, 10/day.
  Each successful AI review also costs one message; atomic dual reservation; reset midnight WIB.
- Membership Rp19.000 per active billing period; standard review Free Rp50.000,
  Member first Rp30.000 then Rp35.000 per billing period, no carryover.
- AI review pilot caps Free 10 pages / Member 20, plus upload/text/token caps.
- Approved-template launch categories PKS, Utang Piutang, NDA; exclusive partner firm.
- AI drafting/review free within quotas; subscription optional. Legal Vault/version history.
- Separate custom-quote Special Legal Case. No live e-sign/e-meterai, notarial workflows,
  legal representation automation, outcome guarantees or advanced RAG in first MVP.
- Production gates and unresolved gateway/payment/renewal/privacy details remain unresolved.

## New approved v8 decisions
- Three dashboard surfaces: customer, partner/reviewer, platform admin.
- Standard completion: Legal Verified with/without Legal Note, subject to real professional
  completion and recorded scope. Without notes maps to WITHIN_SCOPE; with notes to WITH_NOTES.
- Deep Review only after completed Standard Review with actionable Legal Notes; optional.
  It is additional to standard review: Free Rp200.000 / active Member Rp150.000.
- Enhanced is a special professional extra-review outcome, never a payment entitlement.
  Extra review completion and affirmative material-criteria assessment are both mandatory.
- QR verification is required for newly issued v8 verification records/exports; public lookup
  stays minimal and never publishes document contents. Historical v7 records need not be reissued.
- Risk-based tests, not E2E after each change. Maintain E2E scenarios and run by impact/release.

## Conservative engineering defaults (not new commercial/legal approval)
- Same version/hash for standard→deep eligibility; changes require fresh standard review.
- One live deep request per parent standard review/version; no blind repeat charging.
- Revalidate eligibility at quote, order, payment reconciliation and review completion.
- Membership price is snapshotted on accepted unexpired quote; expiry TTL is configurable
  and must be agreed before paid launch. No retroactive repricing settled orders.
- Material criteria in DEEP_REVIEW.md are a proposed implementation rubric requiring
  partner signoff, not a declaration of Indonesian law or legal approval.
- Paid review becoming ineligible goes to operations resolution, never silent issuance/refund.
Refunds, re-review rounds, SLA and negative-outcome legal wording require signed policy.

## Uploaded documents (Task 6) — keputusan pengendali, menunggu konfirmasi pemilik/mitra hukum
- Version hash for an uploaded document = SHA-256 of the frozen extracted canonical text (the exact text AI and
  reviewers read; used in QR, `/verify` and exports, which carry the note "Kode ini untuk teks hasil pembacaan,
  bukan berkas asli."). The SHA-256 of the exact original file bytes is stored separately (`document_uploads`)
  and shown to the owner with a distinct label. Keputusan pengendali, menunggu konfirmasi pemilik/mitra hukum.
- AI Verified is issued only for uploaded documents, not AI-assisted template documents (those still receive the
  pre-review report, without an AI Verified record). Enforced in the server handler. Keputusan pengendali, menunggu
  konfirmasi pemilik/mitra hukum.

## Review integrity (Task 12, audit B) — keputusan pengendali, menunggu konfirmasi pemilik/mitra hukum
- Verified label (SECURITY_AND_LEGAL "Mandatory copy", exact): "Dokumen versi ini telah diperiksa oleh profesional hukum sesuai
  ruang lingkup review yang tercantum. Tidak menjamin keabsahan atau hasil hukum tertentu." It is shown IN ADDITION to the
  VERIFICATION_POLICY statements (with notes / without notes / Enhanced) and the legal disclaimer, on every ACTIVE LEGAL and
  LEGAL_ENHANCED surface: owner result pages (`/reviews/[id]`, `/deep-reviews/[id]`), the owner document verification panel,
  public `/verify/[code]`, and the verification block of DOCX/PDF exports. It is not shown for AI records or for revoked or
  suspended records. Neither text replaces the other; both were mandated by current specs.
- UI never uses the word "cap": the checkout statement says "verifikasi Enhanced" where VERIFICATION_POLICY says
  "cap Enhanced" (owner instruction in plan BG; meaning unchanged).
- Work authorship: report text, Legal Notes, Deep note dispositions and M1–M7 checklist rows record the reviewer and the
  assignment that saved them. Only rows saved under the deciding reviewer's current assignment count at publish/decision;
  after reassignment the new reviewer must review and re-save (re-confirm) each item. Rows of a reviewer whose authority was
  revoked are never carried forward because the old assignment has ended.
- Conflict of interest: a reviewer can never be the document owner (checked at assignment and inside the issuing
  transaction). A firm coordinator can record a firm-level conflict with a document owner (`firm_conflicts`, append-only),
  which blocks assignment and issuance within that firm. Every Standard publish and Deep decision requires an explicit
  "tidak ada konflik kepentingan" statement by the reviewer, stored with the report (`no_conflict_attested_at`) and in the
  verification issuer snapshot. Clearing a firm conflict, rerouting to another firm and the refund path are not implemented
  and need partner policy.
- Deep eligibility also rejects when the parent document has an open Special Legal Case (`SPECIAL_CASE_OPEN`).
- `ENHANCED_ISSUANCE` is enforced twice: in the server handler/action and inside `decide_deep` (the server passes the flag value).

## Security hardening (Task 13, audit C) — keputusan pengendali
- `/api/ai/chat` (relai LLM umum tanpa dokumen, tidak dipakai UI) dihapus. AI hanya lewat jalur pemilik dokumen
  (`/api/documents/[id]/chat`, aksi server dokumen, analisis awal unggahan). `/api/ai/*` kini permukaan pemilik.
- Penjaga rute: API yang tidak terdaftar butuh login (tertutup bawaan), kecuali `/api/jobs/*` (CRON_SECRET) dan
  `/api/payments/webhook/*`. Halaman di grup `(app)`, `(admin)`, `(partner)` wajib tercakup penjaga; tes struktural gagal bila
  ada halaman/rute baru yang lolos. Halaman tak dikenal di luar grup itu tetap dibiarkan agar 404 tampil untuk anonim.
- `/api/partner/*` hanya untuk peran mitra (proxy dan handler sama). Admin platform merutekan lewat `/admin/routing`
  (aksi server) sesuai PERMISSIONS "operational routing"; admin tidak pernah mengerjakan atau memutuskan review.
  Aksi server mitra memeriksa peran: kerja reviewer = `reviewer`; catat konflik firma = `partner_admin`;
  tugaskan/pindahkan = `partner_admin` atau `platform_admin`.
- Konflik firma berlaku untuk pasangan (firma, pemilik). Saat dicatat, semua permintaan Standar/Deep pemilik itu yang masih
  berjalan di firma itu dilepas: penugasan aktif berakhir dan permintaan kembali ke perutean admin (firma dikosongkan).
  Admin melihat tanda konflik dan menugaskan ke firma lain; reviewer firma yang berkonflik tetap ditolak. Pencabutan konflik
  dan pengembalian dana karena konflik tetap belum ada di sistem (kebijakan mitra).
- CSP memakai nonce per permintaan; semua halaman dirender dinamis (biaya: tanpa halaman statis/CDN). `'unsafe-inline'` hanya
  untuk gaya (atribut style React); `'unsafe-eval'` dan `ws:` hanya di luar produksi.
- Konfirmasi baca lewat email dinyatakan belum tersedia sampai ada adapter penyedia email nyata (`EMAIL_PROVIDER`); tanpa
  itu tidak ada tantangan kode yang dibuat. Pengingat email juga ditandai belum terkirim.
- Pembatas laju auth di aplikasi (Postgres, hash kunci) gagal-terbuka bila database pembatas tidak dapat dihubungi; batas
  Supabase Auth tetap lapisan kedua.

## UX audit D (Task 14)
- "Saya belum tahu" (`/workspace/pilih`): percakapan singkat di mana AI menyarankan SATU template katalog (NDA, PKS,
  UTANG_PIUTANG) atau rute Kasus Khusus. Wajib masuk; satu pesan AI per giliran dengan reservasi atomik dan kunci idempoten
  (kunci sama tidak dipotong dua kali dan tidak memanggil AI lagi); dilepas bila gateway gagal atau keluaran rusak. Pilihan
  model divalidasi terhadap registri template di server; dokumen di luar katalog tidak pernah ditawarkan. Memulai dokumen
  tetap lewat aksi pembuatan dokumen biasa, lalu berlanjut di percakapan dokumen. Percakapan pemilih TIDAK disimpan di server
  (tanpa tabel/migrasi baru, tanpa isi pesan di ekspor/penghapusan); riwayat singkat dibawa klien dan hanya menjadi konteks.
  Akibatnya jawaban yang hilang di jaringan tidak dapat diputar ulang: kunci yang sama menjawab "sudah diproses".
- Teks dari alamat (`?error=`, `?notice=`, `?e=`, `?r=`, ...) tidak pernah ditampilkan apa adanya: kode dikenal dipetakan
  ke kalimat tetap (`fixedText`, menolak nama bawaan objek), ID divalidasi sebagai UUID sebelum masuk tautan, email di `/s/[token]`
  ditampilkan tersamar.
- Hasil Standar menyebut nama firma mitra yang menangani (bukan identitas pribadi reviewer) dan tanggal; laporan pemeriksaan
  belum dapat diunduh sebagai berkas (dinyatakan jujur; dokumen versi itu dapat diunduh dengan blok verifikasi). DECLINED
  dijelaskan persis seperti `publish_standard`: order dibatalkan dan diganti 1 kredit pemeriksaan standar (berlaku 90 hari,
  dipakai otomatis oleh `quote_price`). INCONCLUSIVE tidak membuat kredit atau pengembalian dana otomatis, dan dinyatakan begitu.
- `loading.tsx` hanya di segmen `/dashboard`: di segmen yang memuat halaman bersarang dengan `notFound()`, respons yang
  mengalir lebih dulu membuat status 404 menjadi 200.

## Lencana medali dan flag produksi (Task 20) — keputusan pemilik 17 Okt 2026
- **Lencana medali bronze/silver/gold.** Desain dan teks lencana berasal dari brief mitra hukum dan disetujui pemilik
  (sumber: pernyataan pemilik di sesi kerja 17 Okt 2026; referensi dokumen brief mitra dapat ditambahkan pemilik).
  Medali = mark small Yuktanya di dalam cincin logam dengan tulisan di bawahnya (`VerificationMedal`,
  `src/components/verification/verification-medal.tsx`; salinan SVG statis `public/brand/medals/`). Keputusan ini
  menggantikan aturan brand kit lama "lencana tidak boleh memakai perisai, gold, atau mark logo" dan segel
  lingkaran-centang `VerificationSeal` (dihapus).
  - Bronze "AI Verified" / "Pemeriksaan Awal oleh AI" memvisualkan tingkat **AI Verified yang sudah ada di v8**
    (kind `AI`, hanya untuk dokumen unggahan). Aturan penerbitan tidak berubah: dokumen hasil template tetap tidak
    pernah mendapat AI Verified, sehingga laporan AI dokumen template tetap tanpa medali.
  - Silver "Legal Verified" / "Legal Review · Dengan Catatan" atau "Legal Review · Sesuai Lingkup": rekaman LEGAL
    aktif dengan hasil WITH_NOTES / WITHIN_SCOPE.
  - Gold "Legal Verified Enhanced" / "Pemeriksaan lanjutan profesional": hanya rekaman LEGAL_ENHANCED aktif
    (ENHANCED_APPROVED). Tanpa rekaman Enhanced yang sah, gold tidak pernah dirender.
  - Tidak ada tingkat atau aturan penerbitan baru; tingkat dipetakan dari jenis + status + hasil server
    (`medalFor`, `src/lib/verification/medal.ts`). Judul resmi `VERIFICATION_TITLES`, pernyataan wajib, dan ekspor
    DOCX/PDF (teks, tanpa grafis medali) tidak berubah.
  - Pengaman yang berlaku dan diuji (`tests/unit/verification-medal.test.tsx`, E2E `journey-ai-review`,
    `journey-roles`, `journey-prod-ai`): (1) bronze tidak pernah memuat "Legal", "Sah", atau "Terjamin", tidak pernah
    untuk LEGAL/LEGAL_ENHANCED, dan setiap tempat bronze tetap menampilkan penjelasan bahwa AI Verified bukan pemeriksaan
    profesional; (2) bronze tampil di semua tempat rekaman AI Verified tampil (panel verifikasi dokumen, laporan AI
    pemilik, `/verify`, daftar admin), tidak untuk laporan AI dokumen template, dan ekspor tidak diubah; (3) silver/gold
    hanya dari status server yang sudah ada; dicabut/ditangguhkan tanpa medali dengan teks status yang ada;
    `ENHANCED_ISSUANCE` tidak diubah oleh lencana; (4) setiap medali bertuliskan tingkatnya, grafis `aria-hidden`,
    tulisan terbaca pembaca layar; (5) tulisan memakai `heading`/`muted`, garis tepi grafis ≥3:1 terhadap `surface` dan
    `bg` di setiap tingkat, terbaca di 32px; (6) medali bukan logo: wajib cincin + tulisan, hanya dipakai di tampilan
    verifikasi yang tercatat (diuji), tidak di header atau sebagai hiasan.
- **Flag fitur aktif di produksi.** `AI_PREREVIEW_ENABLED`, `DEEP_REVIEW_PURCHASE`, `ENHANCED_ISSUANCE` = true di produksi
  sejak 17 Okt 2026 atas keputusan pemilik (berlaku pada deploy berikutnya). Perilaku kode flag tidak berubah (dibaca dari
  env, mati bila kosong). Gerbang di database tetap berlaku: Enhanced hanya terbit bila rubrik disetujui di
  `/admin/rubric` dan semua penjaga `decide_deep` terpenuhi. Akibat yang tercatat di `docs/RELEASE_CHECKLIST.md`
  (bagian "Flag produksi").

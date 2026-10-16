# Yuktanya — Claude Code Blueprint v8

Pembaruan 16 Oktober 2026 dari paket v7 asli yang disediakan pemilik. Ini handoff produk
dan engineering, bukan aplikasi yang sudah selesai. Bahasa UI: Indonesia; slogan tetap
**Legal Service Seharga Secangkir Kopi.**

## Mulai di sini
1. Buka CLAUDE.md untuk aturan implementasi.
2. Baca docs/IMPLEMENTATION_GUIDE.md untuk urutan pembangunan dan setup.
3. Salin prompts/CLAUDE_CODE_START.md ke Claude Code setelah folder ini dibuka.
4. Baca docs/AUDIT_REPORT_v8.md untuk konflik yang diselesaikan dan blocker produksi.

## Keputusan utama
| Fitur | Free | Member aktif |
|---|---:|---:|
| Pesan AI/hari | 20 | 60 |
| Dokumen baru/hari | 1 | 5 |
| AI review/hari | 2 | 10 |
| Standard Review | Rp50.000 | Pertama Rp30.000, berikutnya Rp35.000 per periode |
| Tambahan Deep Review, jika memenuhi syarat | Rp200.000 | Rp150.000 |

AI gratis dalam batas kuota; setiap AI review sukses juga memakai satu pesan. Reset
00.00 WIB. Membership Rp19.000/periode tagihan; opsional. Login/register sebelum AI.
Semua LLM melalui gateway FreeLLMAPI server-side `model: "auto"`.

Standard Review selesai dapat menerbitkan **Yuktanya Legal Verified** dengan/tanpa Legal
Note sesuai kesimpulan profesional. Deep Review hanya ditawarkan setelah standard selesai
dengan actionable Legal Notes. **Yuktanya Legal Verified — Enhanced** memerlukan pemeriksaan
ekstra, bukti dan konfirmasi profesional berwenang atas kriteria material. Pembayaran tidak
menjamin hasil positif, cap, keabsahan atau hasil hukum. AI Verified tetap jelas terpisah.

Tiga dashboard: pengguna `/dashboard`, partner/reviewer `/partner`, platform admin `/admin`.
Immutable version/hash, catatan, checklist, laporan, audit, QR dan revocation mengikat hasil
ke versi yang benar. Special Legal Case tetap asesmen/penawaran tersendiri.

## Peta dokumen
- Produk: PRODUCT_SPEC, DECISIONS_AND_PRECEDENCE, AI_FAIR_USAGE, VERIFICATION_POLICY, DEEP_REVIEW.
- Dashboard/UX: USER_DASHBOARD, PARTNER_DASHBOARD, ADMIN_DASHBOARD, UX_SPEC, WIREFRAMES,
  DESIGN_SYSTEM, USER_FLOWS, USABILITY_TEST_PLAN.
- Engineering: ARCHITECTURE, DATA_MODEL, PERMISSIONS, WORKFLOWS, SECURITY_AND_LEGAL.
- Eksekusi: IMPLEMENTATION_GUIDE, DELIVERY_PLAN, TEST_STRATEGY, OPEN_QUESTIONS,
  tests/e2e/SCENARIOS.md dan tests/policy-vectors.json.
- Audit: AUDIT_REPORT_v8 dan SOURCE_INVENTORY; audit v6/v7 hanya sejarah.
Semua nama di atas berada di docs/ kecuali path yang disebut lengkap.

## Kebijakan tes
Claude tidak menjalankan E2E untuk setiap perubahan. Gunakan pemeriksaan sesuai dampak;
E2E terpilih untuk perubahan alur kritis dan smoke menjelang rilis. Paket ini menyediakan
spesifikasi tes, bukan bukti aplikasi sudah diuji. Validator paket hanya memeriksa integritas.

## Batasan yang dipertahankan
Next.js/TypeScript/Tailwind/shadcn + Supabase Auth/Postgres/private Storage/RLS, modular
monolith, biaya tambahan minimal. PKS/Utang Piutang/NDA memerlukan persetujuan partner.
Exclusive partner firm, Legal Vault, aksesibilitas pengguna awam/orang tua, tanpa wajib
subscription. Live e-sign/e-meterai, notarial workflows dan advanced RAG di luar MVP.
Gateway endpoint/privasi upstream, hosting komersial, legal/professional signoff, refund,
renewal, scope/SLA dan final rubric tetap membutuhkan validasi sebelum produksi.

## Menjalankan lokal (Fase 0–1)
Butuh Node 22 dan Postgres 16 (server tes DB memakai `initdb` dari `/usr/lib/postgresql/16/bin`).
```
npm ci
npm run check     # lint + typecheck + unit + DB (tanpa jaringan, tanpa data nyata)
npm run dev
```
CI GitHub hanya manual (`workflow_dispatch`) sampai kuota Actions reset (~1 Nov 2026).
Ketersediaan Postgres 16 di runner GitHub belum diverifikasi; cek pada run manual pertama.

## Alur dokumen (Fase 2)
Pengguna terdaftar memilih PKS, Utang Piutang, atau NDA, menjawab pertanyaan satu per satu (`/workspace/[id]`), memeriksa ringkasan, lalu membuat versi yang tidak dapat diubah. Setiap versi punya SHA-256 yang dihitung database atas byte kanonik; ekspor DOCX/PDF punya hash sendiri. Kuota dokumen baru dipakai saat versi pertama berhasil dibuat.

Variabel lingkungan: `DOCUMENT_BLOB_DIR` (berkas ekspor lokal, default `.data/blobs`), `ALLOW_UNAPPROVED_TEMPLATES=true` (hanya di luar produksi; ketiga template berstatus DRAFT sintetis menunggu persetujuan mitra hukum), `SUPABASE_STORAGE_BUCKET` (produksi; adapter belum diverifikasi).
Di produksi template hanya dipakai bila baris `document_templates` berstatus `APPROVED` dengan `content_hash` yang sama dengan kode.

## Vault aktif (Fase 2b)
Fitur berbagi, pengingat, dan paket bukti dikunci per plan lewat `feature_plan_map` (usulan awal: hanya Member; dapat diubah platform admin di `/admin/features`). Link berbagi memakai token acak yang hanya disimpan sebagai hash; pihak lawan membaca di `/s/[token]` tanpa akun dan dapat memberi konfirmasi baca lewat kode email (bukan tanda tangan elektronik). Email dikirim lewat outbox; pengirim nyata belum dipilih (mock saja), dan penjadwal memanggil `POST /api/jobs/outbox` dengan `CRON_SECRET`.

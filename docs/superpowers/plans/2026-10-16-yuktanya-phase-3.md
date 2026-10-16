# Yuktanya Phase 3 Implementation Plan — Penagihan, Review Standar, Legal Verified, QR

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pengguna membeli membership atau review standar lewat order yang dihitung server, pembayaran hanya sah setelah settlement terverifikasi, reviewer profesional yang berwenang menyelesaikan review dengan Legal Note, dan hasilnya menerbitkan catatan verifikasi (AI, Legal) yang dapat dicek publik lewat kode dan QR serta dapat dicabut.

**Architecture:** Aturan uang, hak, dan kewenangan hidup sebagai fungsi SQL `SECURITY DEFINER` yang atomik; TypeScript memanggil dan memvalidasi. Adapter pembayaran (mock, manual) di balik satu antarmuka. Penerbitan verifikasi hanya terjadi di dalam transaksi `publish_standard` oleh reviewer yang ditugaskan dan berwenang; pembayaran, AI, dan admin tidak dapat menerbitkan kesimpulan profesional.

**Tech Stack:** lanjutan Fase 0–2b + `qrcode` (QR PNG).

**Spec:** `docs/superpowers/specs/2026-10-16-yuktanya-v8-extension-design.md` §4, §5, §6, §8. Blueprint: `docs/VERIFICATION_POLICY.md`, `docs/PERMISSIONS.md`, `docs/PARTNER_DASHBOARD.md`, `docs/WORKFLOWS.md` §D/§G, `docs/DATA_MODEL.md`, `docs/SECURITY_AND_LEGAL.md`, `docs/USER_DASHBOARD.md`. Fase sebelumnya: `...-phase-2b.md`.

## Global Constraints

- Semua Global Constraints Fase 2 dan 2b berlaku (UI Indonesia sederhana, target sentuh ≥ 48px, tanpa kata "cap" di UI, teks tetap untuk pesan, hanya data sintetis, `npm run check`, CI manual, commit trailers, branch `claude/great-cerf-8hwfjk`).
- Harga terkunci (integer IDR, dihitung di server/DB): membership Rp19.000 per periode; review standar Free Rp50.000, Member pertama per periode Rp30.000, berikutnya Rp35.000; satu entitlement "pertama" `RESERVED` atau `CONSUMED` per periode membership (indeks unik parsial), dilepas bila pembayaran gagal/kedaluwarsa. Paket tahunan = 12 baris membership bulanan berurutan (12 slot); kredit bundle tidak ditumpuk dengan diskon. Harga tahunan dan bundle **UNKNOWN**: tidak ada baris katalog sampai pemilik mengisi lewat `set_price`; tanpa baris, produk tidak dapat dipesan (`PRODUCT_UNAVAILABLE`).
- Pembayaran sah hanya lewat `settle_payment` dari adapter terpercaya (kunci idempoten `provider + event_id`); redirect browser dan bukti unggahan tidak pernah menjadi dasar. Jumlah settlement harus sama dengan order; selisih/terlambat → `RECONCILIATION_REQUIRED`, tanpa aktivasi.
- Order `PENDING_PAYMENT` berlaku 24 jam (default rekayasa); `expire_orders` melepas reservasi.
- Review standar terikat satu versi dan hash beku; satu review aktif/selesai per versi (tanpa penagihan ulang buta); versi diedit = versi baru yang memerlukan order baru.
- Kewenangan profesional: reviewer harus anggota firma, memiliki otorisasi aktif (`valid_from <= hari ini <= valid_to`, tidak dicabut), ditugaskan aktif, dan bukan pemilik dokumen; semua diperiksa ulang di transaksi penyelesaian. Peran koordinator hanya menugaskan di firmanya; `platform_admin` hanya merutekan operasional dan tidak pernah menerbitkan kesimpulan.
- Hasil standar: `WITH_NOTES` (≥ 1 Legal Note terpublikasi), `WITHIN_SCOPE` (0 catatan dan deklarasi eksplisit), `INCONCLUSIVE`/`DECLINED` (tanpa badge). Penyelesaian wajib atestasi profesional eksplisit. Catatan dan laporan final tidak dapat diubah (trigger).
- Verifikasi: kode opaque acak, hash SHA-256 persis dari versi yang diperiksa, QR ke `/verify/[kode]` dengan URL/kode yang dapat dibaca, tanpa data pribadi. Halaman publik minimal (jenis, status aktif/dicabut/tidak ditemukan, tanggal terbit, kode, hash, ruang lingkup bila disetujui); penerbit dan ruang lingkup publik **dimatikan** sampai persetujuan privasi (flag `PUBLIC_ISSUER_DISCLOSURE`, default OFF). Pencabutan bersifat append-only dan terlihat seketika (tanpa cache). QR bukan tanda tangan. Teks hasil memakai bahasa wajib `VERIFICATION_POLICY.md`; tanpa kata "cap" di UI.
- AI Verified hanya setelah analisis AI berhasil tersimpan untuk versi/hash persis itu, di balik `AI_PREREVIEW_ENABLED` dan persetujuan eksplisit pengguna; bukan pengesahan hukum. Unggahan PDF/DOCX **tidak** termasuk fase ini (parser, pemindaian malware, dan gerbang privasi belum diputuskan).
- Metode bayar: adapter `mock` (hanya non-produksi) dan `manual` (platform admin mengonfirmasi dengan referensi bank). Gateway Midtrans/Xendit **UNKNOWN** (tarif, tanda tangan webhook) dan tidak diimplementasikan; rute webhook penyedia lain menjawab 404.
- Default rekayasa (bukan keputusan pemilik): kapasitas 10 review aktif per reviewer; order berlaku 24 jam.

## Review Focus

1. Dua order serentak oleh Member untuk periode yang sama: tepat satu mendapat harga pertama; order gagal/kedaluwarsa melepas hak; tidak ada dobel aktivasi dari callback ganda. (Task 1–2)
2. Pembayaran: jumlah salah, order kedaluwarsa, callback ganda/serentak, pembayaran atas order milik orang lain tidak pernah mengaktifkan atau menerbitkan apa pun. (Task 2–3)
3. Hanya reviewer yang ditugaskan, berwenang, bukan pemilik, dan belum dicabut dapat membaca berkas dan menyelesaikan review; admin/koordinator/pemilik tidak dapat menerbitkan; tanpa atestasi tidak ada penerbitan. (Task 5–7)
4. Setelah hash versi tidak cocok, versi diubah, atau otorisasi dicabut di tengah jalan, penyelesaian ditolak dan tidak ada verifikasi. (Task 6–7)
5. Halaman verifikasi publik: kode tak dikenal, dicabut, versi lama; tanpa kebocoran isi, nama pihak, atau catatan privat; enumerasi dibatasi laju. (Task 8–9)

## File Structure

```
supabase/migrations/2026101600001{6..9}_*.sql        # billing, reviews, verification, fulfillment
src/lib/billing/{service,adapters,handlers}.ts
src/lib/reviews/{service,handlers,copy}.ts
src/lib/verification/{service,qr,handlers}.ts
src/lib/ai/prereview.ts
src/app/(app)/{membership,checkout/[orderId],reviews,reviews/[id]}/page.tsx
src/app/(partner)/partner/{page,reviews/[id]/page,team/page,actions}.tsx
src/app/(public)/verify/[code]/page.tsx
src/app/(admin)/admin/payments/page.tsx
src/app/api/{orders,payments,reviews,verify}/**
tests/db/{billing,settlement,reviews,publish,verification,prereview}.test.ts
```

---

### Task 1: Katalog harga, order, dan diskon pertama (DB)

**Files:** Create `supabase/migrations/20261016000017_billing.sql`, `tests/db/billing.test.ts`.

**Interfaces:** Produces tabel `price_catalog(kind text, variant text, amount_idr int > 0, primary key(kind, variant))` dengan seed terkunci (`STANDARD_REVIEW/FREE` 50000, `/MEMBER_FIRST` 30000, `/MEMBER_LATER` 35000, `MEMBERSHIP_MONTHLY/DEFAULT` 19000); `orders(id, user_id, kind check in ('MEMBERSHIP_MONTHLY','MEMBERSHIP_ANNUAL','BUNDLE','STANDARD_REVIEW'), ref_id uuid, status check in ('PENDING_PAYMENT','PAID','EXPIRED','CANCELLED','RECONCILIATION_REQUIRED'), amount_idr int >= 0, price_snapshot jsonb, idempotency_key, expires_at, created_at, paid_at, unique(user_id, idempotency_key))`; `review_discount_entitlements(id, membership_id, order_id unique, status check in ('RESERVED','CONSUMED','RELEASED'))` dengan indeks unik parsial `(membership_id) where status in ('RESERVED','CONSUMED')`; `review_credits(id, user_id, order_id, expires_at, status check in ('AVAILABLE','RESERVED','CONSUMED','EXPIRED'), reserved_by_order)`; SQL `preview_price(p_user uuid, p_kind text, p_ref uuid, p_now timestamptz) returns table(amount_idr int, variant text, uses_credit boolean)` (baca saja); `create_order(p_user uuid, p_kind text, p_ref uuid, p_key text, p_now timestamptz) returns table(order_id uuid, status text, amount_idr int, duplicate boolean)` (pemilik versi untuk `STANDARD_REVIEW`, satu review aktif/selesai per versi → `ALREADY_REVIEWED`, kredit tersedia → order Rp0 langsung `PAID`, kunci advisory per user, `PRODUCT_UNAVAILABLE` bila katalog kosong); `set_price(p_admin uuid, p_kind text, p_variant text, p_amount int)` (hanya `platform_admin`, diaudit); `expire_orders(p_now timestamptz) returns int`.

- [ ] **Step 1: Failing tests:** seed katalog sama dengan `PRICING` (`src/lib/pricing/catalog.ts`) dan `tests/policy-vectors.json`; Free → Rp50.000; Member aktif pertama → Rp30.000 dan entitlement `RESERVED`, order kedua dalam periode sama → Rp35.000; dua `create_order` serentak (dua koneksi) → tepat satu Rp30.000; periode baru (membership kedua) mendapat harga pertama lagi; `expire_orders` setelah 24 jam melepas entitlement dan order berikutnya kembali Rp30.000; kunci idempoten sama → order sama (`duplicate`); versi orang lain → `NOT_FOUND`; versi yang sudah punya order/review aktif → `ALREADY_REVIEWED`; `MEMBERSHIP_ANNUAL` dan `BUNDLE` tanpa baris katalog → `PRODUCT_UNAVAILABLE`, setelah `set_price` oleh admin tersedia dan non-admin ditolak (`FORBIDDEN`); kredit `AVAILABLE` → order Rp0 `PAID` tanpa menyentuh entitlement diskon; `authenticated` tidak dapat memanggil fungsi.
- [ ] **Step 2:** `npm run test:db` → FAIL. **Step 3: Implement** (preview dan create memakai fungsi harga yang sama). **Step 4:** PASS. **Step 5: Commit** `feat(db): price catalog, orders, first-review discount ledger`.

### Task 2: Pembayaran dan settlement idempoten (DB)

**Files:** Create `supabase/migrations/20261016000018_payments.sql`, `tests/db/settlement.test.ts`.

**Interfaces:** Produces tabel `payments(id, order_id, provider check in ('mock','manual'), provider_ref, status check in ('PENDING','VERIFIED','FAILED','EXPIRED','REFUNDED','DISPUTED'), amount_idr, fee_idr default 0, verified_at, created_at, unique(provider, provider_ref))`, `payment_events(provider, event_id, received_at, primary key(provider, event_id))`; SQL `create_payment(p_user uuid, p_order uuid, p_provider text, p_provider_ref text, p_now timestamptz) returns uuid` (order milik user, `PENDING_PAYMENT`, belum kedaluwarsa), `settle_payment(p_provider text, p_provider_ref text, p_event_id text, p_amount int, p_fee int, p_now timestamptz) returns text` (`SETTLED|DUPLICATE|NOT_FOUND|AMOUNT_MISMATCH|RECONCILIATION_REQUIRED`), `confirm_manual_payment(p_admin uuid, p_payment uuid, p_bank_ref text, p_amount int, p_now timestamptz) returns text` (hanya `platform_admin`; memanggil `settle_payment('manual', ..., event 'manual:'||payment)`; audit), `fulfill_order(p_order uuid, p_now timestamptz) returns void` (membership bulanan: 1 baris `ACTIVE`, dirantai bila sudah ada periode berjalan; tahunan: 12 baris berurutan; bundle: N kredit berumur; review: memanggil `create_review_request` yang disediakan Task 5; menandai entitlement `CONSUMED`).

- [ ] **Step 1: Failing tests:** settle sukses → payment `VERIFIED`, order `PAID`, membership `ACTIVE` dengan periode benar (tanggal berikutnya dirantai bila perpanjangan), dan `resolve_entitlement` menjadi `MEMBER`; callback ganda dan serentak dengan `event_id` sama → satu aktivasi; jumlah salah → `AMOUNT_MISMATCH`, payment `DISPUTED`, tanpa aktivasi; setelah order kedaluwarsa → `RECONCILIATION_REQUIRED` tanpa aktivasi; `provider_ref` tak dikenal → `NOT_FOUND`; pembayaran untuk order orang lain tidak dapat dibuat; `confirm_manual_payment` oleh non-admin → `FORBIDDEN`; membership PENDING (order belum settle) tidak memberi kuota Member; paket tahunan menghasilkan 12 periode dan masing-masing memberi satu diskon pertama; `fee_idr` tercatat; `authenticated` tidak dapat memanggil fungsi atau membaca tabel.
- [ ] **Step 2:** FAIL. **Step 3: Implement.** **Step 4:** PASS. **Step 5: Commit** `feat(db): idempotent payment settlement and order fulfillment`.

### Task 3: Layanan penagihan, adapter, dan API

**Files:** Create `src/lib/billing/{service,adapters,handlers}.ts`, `src/app/api/orders/route.ts`, `src/app/api/orders/[id]/{route,pay}/route.ts`, `src/app/api/payments/mock/settle/route.ts`, `src/app/api/admin/payments/[id]/confirm/route.ts`, `src/app/api/payments/webhook/[provider]/route.ts`, `tests/db/billing-handlers.test.ts`.

**Interfaces:** Produces `interface PaymentAdapter { name: "mock" | "manual"; createCharge(order: { id: string; amountIdr: number }): Promise<{ providerRef: string; instructions: string }> }`; `createPgBillingService(pool, adapters): { preview(userId, kind, refId, now?): Promise<Quote>; createOrder(userId, kind, refId, key, now?): Promise<OrderResult>; startPayment(userId, orderId, provider, now?): Promise<{ paymentId: string; instructions: string }>; getOrder(userId, orderId): Promise<OrderView | null>; listOrders(userId): Promise<OrderView[]> }`; handler berinjeksi (pola `DocDeps`): `createOrderHandler`, `getOrderHandler`, `payHandler`, `mockSettleHandler` (hanya non-produksi, selain itu 404), `confirmManualHandler` (hanya `platform_admin`, selain itu 403), `webhookHandler` (penyedia selain `mock` → 404). Kode galat: `AUTH_REQUIRED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `ALREADY_REVIEWED` 409, `PRODUCT_UNAVAILABLE` 409, `INVALID_REQUEST` 400. Pembuatan order wajib `Idempotency-Key`. `ForbiddenError` untuk peran non-pemilik seperti dokumen.

- [ ] **Step 1: Failing tests:** anonim 401 di semua handler; order milik orang lain 404 dengan badan identik dengan ID acak; harga klien (`amount`, `plan`) diabaikan; pratinjau memuat rincian dan `CHECKOUT_NOTE`; `mockSettleHandler` di produksi → 404 dan di non-produksi menyelesaikan order lalu membuat Member aktif; `confirmManualHandler` oleh non-admin 403, oleh admin menyelesaikan; webhook `midtrans` → 404; kunci sama dua kali → satu order.
- [ ] **Step 2:** FAIL. **Step 3: Implement.** **Step 4:** PASS. **Step 5: Commit** `feat(billing): service, mock/manual adapters, and API`.

### Task 4: Halaman membership, checkout, dan admin pembayaran

**Files:** Create `src/app/(app)/membership/page.tsx`, `src/app/(app)/checkout/[orderId]/page.tsx`, `src/app/(app)/checkout/actions.ts`, `src/components/billing/{price-breakdown,order-status}.tsx`, `src/app/(admin)/admin/payments/{page,actions}.tsx`, `tests/unit/billing-ui.test.ts`; Modify `src/app/(app)/documents/[id]/page.tsx` (tombol "Minta pemeriksaan pengacara").

**Interfaces:** Consumes `BillingService`. `PriceBreakdown({ quote })` menampilkan layanan, harga, aturan member (pertama Rp30.000, berikutnya Rp35.000, tidak semua Rp30.000), `CHECKOUT_NOTE`; `OrderStatus({ order })` menampilkan status dengan teks (bukan warna saja): `Menunggu pembayaran`, `Pembayaran dikonfirmasi`, `Kedaluwarsa`.

- [ ] **Step 1: Failing tests:** `PriceBreakdown` memuat `Rp50.000`/`Rp30.000`/`Rp35.000` sesuai plan, kalimat pernyataan pembayaran, tanpa kata "cap", tombol/tautan `min-h-12`; kartu Member tidak menyebut "semua Rp30.000"; `OrderStatus` memuat teks status.
- [ ] **Step 2:** FAIL. **Step 3: Implement** (checkout memanggil `createOrder` dengan kunci acak per kunjungan; instruksi manual dari `MANUAL_PAYMENT_INSTRUCTIONS`, env kosong → pesan "Instruksi pembayaran belum tersedia"). **Step 4:** PASS + `npm run build`. **Step 5: Commit** `feat(ui): membership, checkout, and admin payment confirmation`.

### Task 5: Firma, otorisasi profesional, permintaan review, dan penugasan (DB)

**Files:** Create `supabase/migrations/20261016000019_reviews.sql`, `tests/db/reviews.test.ts`.

**Interfaces:** Produces tabel `firms(id, name, is_default)`, `firm_members(firm_id, user_id, role check in ('reviewer','coordinator'), unique(firm_id, user_id))`, `professional_authorizations(id, user_id, firm_id, scope_note, valid_from date, valid_to date, revoked_at, verified_by, created_at)`, `review_requests(id, version_id, owner_id, order_id unique, firm_id, version_sha256, status check in ('QUEUED','ASSIGNED','IN_REVIEW','COMPLETED','DECLINED','CANCELLED'), outcome, created_at, completed_at)` (unik parsial satu permintaan aktif/selesai per versi), `review_assignments(id, request_id, reviewer_id, assigned_by, assigned_at, ended_at, status check in ('ACTIVE','ENDED'))`; SQL (hanya `service_role`): `admin_register_firm(p_admin, p_name, p_default)`, `admin_add_member(p_admin, p_firm, p_user, p_role)`, `admin_authorize(p_admin, p_user, p_firm, p_scope, p_from, p_to)`, `admin_revoke_authorization(p_admin, p_auth, p_now)` (semuanya hanya `platform_admin`, diaudit); `create_review_request(p_order uuid, p_now timestamptz) returns uuid` (hash disalin dari versi, firma bawaan); `assign_review(p_actor uuid, p_request uuid, p_reviewer uuid, p_now timestamptz) returns void`; `reviewer_has_authority(p_reviewer uuid, p_firm uuid, p_now timestamptz) returns boolean`; `reviewer_queue(p_reviewer uuid) returns table(...)`; `reassign_review(...)` (mengakhiri penugasan lama).

- [ ] **Step 1: Failing tests:** settlement order `STANDARD_REVIEW` membuat tepat satu permintaan `QUEUED` dengan `version_sha256` sama dengan hash versi; `assign_review` oleh koordinator firmanya sukses; oleh koordinator firma lain, reviewer biasa, pemilik, atau pengguna biasa → `FORBIDDEN`; `platform_admin` boleh merutekan; reviewer tanpa otorisasi, otorisasi kedaluwarsa/dicabut, bukan anggota firma, atau pemilik dokumen yang sama → `REVIEWER_NOT_AUTHORIZED`; kapasitas 10 aktif → `REVIEWER_AT_CAPACITY`; `reassign_review` mengakhiri penugasan lama dan reviewer lama kehilangan akses antrean; satu permintaan aktif per versi; fungsi admin oleh non-admin → `FORBIDDEN` dan perubahan tercatat di `audit_events`; `authenticated` tidak dapat memanggil fungsi atau membaca tabel.
- [ ] **Step 2:** FAIL. **Step 3: Implement.** **Step 4:** PASS. **Step 5: Commit** `feat(db): firms, professional authorization, review requests, assignment`.

### Task 6: Laporan, Legal Note, dan penyelesaian review standar (DB)

**Files:** Create `supabase/migrations/20261016000020_report_publish.sql`, `tests/db/publish.test.ts`.

**Interfaces:** Produces tabel `review_reports(id, request_id unique, revision int, status check in ('DRAFT','FINAL'), scope, assumptions, summary, outcome, author_id, finalized_at)`, `legal_notes(id, report_id, note_no, block_id, quote, title, finding, severity check in ('INFO','MINOR','MATERIAL','CRITICAL'), actionable bool, recommended_action, rationale, escalation, status check in ('DRAFT','PUBLISHED'), unique(report_id, note_no))` dengan trigger tolak ubah/hapus baris `FINAL`/`PUBLISHED`; SQL: `start_review(p_reviewer, p_request, p_now) returns table(version_text text, ...)` (penugasan aktif + otoritas + hash cocok; mencatat `review_file_access` di audit), `save_report_draft(p_reviewer, p_request, p_revision, p_scope, p_assumptions, p_summary) returns int` (`STALE_REVISION`), `upsert_note(p_reviewer, p_request, p_revision, p_note jsonb) returns int`, `delete_note(...)`, `publish_standard(p_reviewer uuid, p_request uuid, p_revision int, p_outcome text, p_no_notes_declared boolean, p_attest boolean, p_now timestamptz) returns table(status text, verification_id uuid, code text)`. Aturan penyelesaian dalam satu transaksi: penugasan aktif, otoritas, bukan pemilik, status `IN_REVIEW`, hash `canonical_text` versi = `version_sha256` permintaan, revisi cocok, `scope` tak kosong, `p_attest` benar (`ATTESTATION_REQUIRED`); `WITH_NOTES` butuh ≥ 1 catatan dan semua catatan aktionabel memiliki `recommended_action` (MATERIAL/CRITICAL juga `rationale` dan `escalation`); `WITHIN_SCOPE` butuh 0 catatan dan `p_no_notes_declared`; `INCONCLUSIVE`/`DECLINED` butuh `summary` dan tidak menerbitkan verifikasi. Hasil: laporan `FINAL`, catatan `PUBLISHED`, permintaan `COMPLETED`/`DECLINED`, baris `document_verifications` kind `LEGAL` (Task 8) dengan hash versi, audit, dan outbox `review_completed` ke pemilik.

- [ ] **Step 1: Failing tests:** alur penuh `start_review` → `save_report_draft` → `upsert_note` → `publish_standard` `WITH_NOTES` menerbitkan tepat satu verifikasi LEGAL dengan hash sama dengan versi dan catatan menjadi `PUBLISHED`; `WITHIN_SCOPE` tanpa deklarasi atau dengan catatan ditolak; `WITH_NOTES` tanpa catatan ditolak; `p_attest = false` → `ATTESTATION_REQUIRED` tanpa efek; reviewer lain/dicabut tengah jalan/koordinator/admin/pemilik → ditolak (`FORBIDDEN`/`REVIEWER_NOT_AUTHORIZED`); revisi basi → `STALE_REVISION`; hash versi diubah paksa di tabel uji (superuser memodifikasi salinan hash permintaan) → `VERSION_MISMATCH` tanpa verifikasi; panggilan ganda dengan revisi sama → satu verifikasi; `INCONCLUSIVE` tanpa badge namun permintaan selesai dan outbox terkirim; laporan/catatan final tidak dapat diubah (trigger); edit pada draf oleh pengguna non-penugasan ditolak; pemilik tidak dapat membaca catatan `DRAFT` (hanya `PUBLISHED` lewat `get_review_for_owner`).
- [ ] **Step 2:** FAIL. **Step 3: Implement.** **Step 4:** PASS. **Step 5: Commit** `feat(db): report, legal notes, and standard review completion`.

### Task 7: Verifikasi (DB), proyeksi publik, pencabutan, dan QR

**Files:** Create `supabase/migrations/20261016000021_verification.sql`, `src/lib/verification/{service,qr}.ts`, `tests/db/verification.test.ts`, `tests/unit/qr.test.ts`; Modify `package.json` (`qrcode`, `@types/qrcode`).

**Interfaces:** Produces tabel `document_verifications(id, kind check in ('AI','LEGAL','LEGAL_ENHANCED'), version_id, sha256, status check in ('ACTIVE','REVOKED','SUSPENDED'), outcome, scope_summary, issuer jsonb, policy_version, code text unique, request_id, ai_report_id, parent_verification_id, issued_at)` dengan constraint khusus jenis (LEGAL: `request_id` wajib; AI: `ai_report_id` wajib), `verification_revocations(id, verification_id, reason_code, private_reason, actor_id, created_at)` append-only; SQL `public_verification(p_code text) returns table(status text, kind text, issued_at timestamptz, sha256 text, scope_summary text, outcome text)` (kode tak dikenal → satu baris `NOT_FOUND`; `scope_summary` null kecuali `PUBLIC_ISSUER_DISCLOSURE` aktif di `app_settings`), `revoke_verification(p_actor uuid, p_id uuid, p_reason text, p_private text, p_now timestamptz)` (hanya `platform_admin` atau reviewer penerbit dengan kewenangan aktif; menulis revokasi, mengubah status, audit), `issue_ai_verification(p_user uuid, p_ai_report uuid, p_now timestamptz) returns table(verification_id uuid, code text)` (laporan milik user, hash laporan = hash versi); TS: `qrPng(url: string): Promise<Uint8Array>`, `verifyUrl(code: string, base?: string): string`, `createPgVerificationService(pool): { lookup(code): Promise<PublicVerification>; forVersion(userId, versionId): Promise<VerificationView[]>; revoke(actor, id, reason, privateReason): Promise<void> }`.

- [ ] **Step 1: Failing tests:** kode acak ≥ 40 karakter unik; `public_verification` kode tak dikenal → `NOT_FOUND`; aktif → hash/jenis/tanggal tanpa isi dokumen, nama pihak, catatan privat, atau ID internal; `scope_summary` null secara default; `revoke_verification` oleh pengguna biasa/pemilik/koordinator → `FORBIDDEN`; oleh admin → status `REVOKED` seketika dan lookup berikutnya `REVOKED`; revokasi append-only (UPDATE/DELETE ditolak); versi yang diedit tidak mewarisi verifikasi (`forVersion` versi baru kosong); AI: `issue_ai_verification` hanya untuk laporan milik pengguna dengan hash cocok, tanpa laporan → ditolak; constraint LEGAL tanpa permintaan ditolak; `qrPng` menghasilkan PNG valid dengan tanda PNG dan URL `…/verify/{code}` yang dapat dibaca; URL tidak memuat data pribadi.
- [ ] **Step 2:** FAIL. **Step 3: Implement.** **Step 4:** PASS. **Step 5: Commit** `feat(verification): records, public projection, revocation, QR`.

### Task 8: Halaman publik `/verify/[code]` dan blok verifikasi pada ekspor

**Files:** Create `src/app/(public)/verify/[code]/page.tsx`, `src/components/verification/{public-verification,verification-panel}.tsx`, `src/lib/reviews/copy.ts`, `tests/unit/verification-ui.test.ts`; Modify `src/lib/documents/export.ts`, `src/lib/documents/service.ts`, `src/lib/copy.ts`, `tests/unit/export.test.ts`.

**Interfaces:** `PublicVerification({ result }: { result: PublicVerificationResult })`: `NOT_FOUND` → "Kode tidak ditemukan"; `REVOKED` → "Dicabut" dengan penjelasan; `ACTIVE` → jenis, tanggal terbit (WIB), kode, hash, teks wajib: `Tidak menjamin keabsahan atau hasil hukum dalam semua keadaan.`; tanpa nama pihak/isi; `no-store`; pembatas laju 30/menit/IP. `exportDocx(doc, verification?)` dan `exportPdf(doc, verification?)` dengan `type ExportVerification = { kindTitle: string; statement: string; code: string; url: string; originalSha256: string; qrPng: Uint8Array }` (blok "Verifikasi" di akhir: judul jenis, pernyataan wajib, URL dan kode yang dapat dibaca, QR, "Kode versi asli: {hash}"); `exportVersion` mencantumkan verifikasi AKTIF terbaru versi itu bila ada dan hash ekspor tetap tersendiri.

- [ ] **Step 1: Failing tests:** halaman publik memuat pesan tetap per status tanpa isi dokumen/nama; pernyataan wajib ada; `PDF`/`DOCX` dengan verifikasi memuat URL, kode, dan pernyataan (DOCX diperiksa lewat `word/document.xml`, PDF dimuat ulang tanpa galat dan ≥ 1 halaman); ekspor tanpa verifikasi tidak memuat blok; ekspor versi yang dicabut tidak memuat blok aktif; hash ekspor ≠ hash versi.
- [ ] **Step 2:** FAIL. **Step 3: Implement.** **Step 4:** PASS + build. **Step 5: Commit** `feat(verification): public lookup page and verification block in exports`.

### Task 9: Analisis AI awal dan AI Verified

**Files:** Create `src/lib/ai/prereview.ts`, `src/app/api/documents/versions/[versionId]/ai-review/route.ts`, `tests/db/prereview.test.ts`.

**Interfaces:** `handleAiReview(deps: { getUserId; service; store: UsageStore; chat; pool; inflight; now? }, req: Request, params: { versionId: string }): Promise<Response>`: butuh `flags.aiPreReview` aktif (mati → 404 `FEATURE_DISABLED`), `Idempotency-Key`, body `{ consent: true }` (tanpa persetujuan eksplisit → 400), reservasi `AI_REVIEW` (dua kuota atomik), satu panggilan gateway + maks 2 perbaikan JSON dengan skema `{ perhatian: string[], belumJelas: string[], pertanyaanUntukPengacara: string[] }`, `save_ai_review` (hash versi), `issue_ai_verification`; respons `{ report, verification: { code, url } }`; kegagalan gateway/parse → kuota dilepas.

- [ ] **Step 1: Failing tests:** flag mati 404; tanpa persetujuan 400; sukses: satu laporan, satu verifikasi `AI`, kuota pesan dan review masing-masing +1; gateway gagal/keluaran rusak → tanpa laporan/verifikasi dan kuota kembali; review ke-3 Free hari yang sama 429 `AI_REVIEW_QUOTA_REACHED`; versi orang lain 404; teks hasil memuat `AI_PREREVIEW_LABEL` ("Analisis awal AI bersifat informasional dan dapat keliru.") dan bahasa wajib AI; tidak membuat verifikasi LEGAL.
- [ ] **Step 2:** FAIL. **Step 3: Implement.** **Step 4:** PASS. **Step 5: Commit** `feat(ai): preliminary review with AI Verified record behind a flag`.

### Task 10: Layanan dan handler review (pemilik dan reviewer)

**Files:** Create `src/lib/reviews/{service,handlers}.ts`, `src/app/api/reviews/**/route.ts`, `tests/db/review-handlers.test.ts`.

**Interfaces:** `createPgReviewService(pool)`: pemilik — `listForOwner(userId)`, `getForOwner(userId, requestId)` (status, linimasa, hasil final, catatan `PUBLISHED`, verifikasi; tidak pernah catatan draf); reviewer — `queue(reviewerId)`, `open(reviewerId, requestId)` (memuat teks versi), `saveDraft(...)`, `upsertNote(...)`, `deleteNote(...)`, `publish(reviewerId, requestId, input)`; koordinator — `unassigned(coordinatorId)`, `assign(coordinatorId, requestId, reviewerId)`. Handler berinjeksi dengan `getActor(): Promise<{ userId; roles } | null>`; rute reviewer memerlukan peran `reviewer`/`partner_admin` di sesi **dan** pemeriksaan DB; rute pemilik memerlukan pemilik biasa. Kode galat: `AUTH_REQUIRED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404 (badan identik), `STALE_REVISION` 409, `VALIDATION_FAILED` 422 (dengan alasan penolakan penerbitan), `ATTESTATION_REQUIRED` 422, `VERSION_MISMATCH` 409.

- [ ] **Step 1: Failing tests:** pemilik tidak dapat membaca catatan draf atau laporan review orang lain (404 identik); reviewer hanya melihat antrean miliknya; reviewer yang bukan penugasan mendapat 404 pada `open`; peran sesi tidak cukup tanpa penugasan DB; `publish` tanpa atestasi 422; koordinator tidak dapat `publish`; admin tidak dapat `publish`; `publish` sukses mengembalikan kode verifikasi; pemilik kemudian melihat hasil dengan catatan terpublikasi.
- [ ] **Step 2:** FAIL. **Step 3: Implement.** **Step 4:** PASS. **Step 5: Commit** `feat(reviews): owner, reviewer, and coordinator services and API`.

### Task 11: Halaman pemilik (Review Saya) dan dashboard mitra

**Files:** Create `src/app/(app)/reviews/{page,[id]/page}.tsx`, `src/components/reviews/{review-timeline,legal-note-card,result-panel}.tsx`, `src/app/(partner)/partner/{page,actions}.tsx`, `src/app/(partner)/partner/reviews/[id]/page.tsx`, `src/app/(partner)/partner/team/page.tsx`, `src/app/(partner)/partner/layout.tsx`, `tests/unit/reviews-ui.test.ts`; Modify `src/lib/auth/permissions.ts` (`/reviews` ke permukaan pemilik).

**Interfaces:** `ReviewTimeline({ status })` (Diajukan → Pembayaran dikonfirmasi → Dalam antrean → Sedang diperiksa → Selesai, dengan teks status); `LegalNoteCard({ note })` (judul, tingkat dengan teks "Penting"/"Sangat penting", tindakan, lokasi) tanpa mengandalkan warna; `ResultPanel({ result, verification })` menampilkan `Selesai — Dengan Legal Note`/`Selesai — Tanpa Legal Note`, ruang lingkup, versi yang diperiksa, kode/QR (`<img>` dari data PNG dan URL teks), serta teks wajib; tanpa kata "cap"; status dicabut/versi lama ditampilkan eksplisit. Halaman mitra: antrean (usia, status), editor catatan dengan pratinjau dan modal konfirmasi akhir yang menyebut versi, hasil, ruang lingkup, dan catatan tersisa; tombol terbit nonaktif menjelaskan syarat yang belum terpenuhi.

- [ ] **Step 1: Failing tests:** komponen memuat teks status (bukan warna saja), tingkat catatan sebagai teks, hasil dan teks wajib per jenis, `Versi baru belum diperiksa` untuk versi tanpa verifikasi, status dicabut, tautan/tombol `min-h-12`, tanpa "cap"; `guardPath` mengarahkan peran profesional dari `/reviews`.
- [ ] **Step 2:** FAIL. **Step 3: Implement** (server action memakai layanan Task 10 dengan `userId` dari sesi). **Step 4:** PASS + build. **Step 5: Commit** `feat(ui): owner review pages and partner dashboard`.

### Task 12: Verifikasi akhir dan review

**Files:** Modify `README.md`, `.env.example` (`MANUAL_PAYMENT_INSTRUCTIONS`, `PUBLIC_ISSUER_DISCLOSURE`, `AI_PREREVIEW_ENABLED`), `PACKAGE_MANIFEST.json`.

- [ ] **Step 1:** `npm run check` dan `npm run build`; catat jumlah tes yang benar-benar jalan.
- [ ] **Step 2:** `grep -rniE "\bcap\b" src` kosong; tidak ada jalur yang menerbitkan verifikasi selain `publish_standard` dan `issue_ai_verification` (`grep -n "insert into public.document_verifications" supabase/migrations`); validator paket PASS.
- [ ] **Step 3:** Review akhir oleh reviewer baru, perbaiki Critical/Important dengan TDD, push.

---

## Self-review (dijalankan)

- **Cakupan:** harga dan diskon pertama atomik (T1), settlement idempoten dan fulfillment termasuk tahunan 12 slot dan bundle (T2), adapter mock/manual dan API (T3), checkout/membership/UI admin (T4), firma, otoritas, penugasan (T5), laporan, Legal Note, penyelesaian dengan atestasi dan hash (T6), verifikasi, pencabutan, QR (T7), halaman publik dan blok pada ekspor (T8), AI Verified (T9), API review (T10), UI pemilik dan mitra (T11).
- **Ditunda ke fase berikut:** Deep Review dan Enhanced (Fase 4); dashboard admin analitik, rekonsiliasi, gateway nyata, dan smoke rilis (Fase 5); unggahan PDF/DOCX untuk analisis AI (menunggu keputusan parser, malware, privasi).
- **UNKNOWN yang tidak menghambat:** harga tahunan/bundle, penyedia pembayaran, instruksi pembayaran manual, kebijakan refund, SLA, redaksi hasil negatif, pengungkapan penerbit publik, verifikasi kredensial (dimasukkan admin).

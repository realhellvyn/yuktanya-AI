# Yuktanya Phase 4 Implementation Plan — Deep Review dan Enhanced

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline, native). Steps use checkbox syntax.

**Goal:** Setelah review standar selesai dengan Legal Note yang dapat ditindaklanjuti, pemilik dapat membeli Deep Review (tambahan Free Rp200.000 / Member aktif Rp150.000); reviewer berwenang mengerjakan pemeriksaan tambahan, checklist material M1–M7, disposisi catatan satu per satu, dan hanya keputusan APPROVE yang memenuhi semua penjaga menerbitkan Yuktanya Legal Verified — Enhanced.

**Architecture:** Lanjutan Fase 3. Kelayakan, harga, penyelesaian, penugasan, dan keputusan akhir hidup sebagai fungsi SQL `SECURITY DEFINER` atomik. Pembayaran tidak pernah menjamin Enhanced. Flag produksi `DEEP_REVIEW_PURCHASE` dan `ENHANCED_ISSUANCE` default OFF; penerbitan Enhanced juga memerlukan rubrik yang sudah disetujui mitra (data, bukan kode).

**Tech Stack:** Next.js, Postgres, vitest (sama seperti Fase 3).

**Spec:** `docs/superpowers/specs/2026-10-16-yuktanya-v8-extension-design.md`; `docs/DEEP_REVIEW.md`, `docs/VERIFICATION_POLICY.md`, `tests/policy-vectors.json`; Fase sebelumnya `...-phase-3.md`.

## Global Constraints

- Semua Global Constraints Fase 3 berlaku (harga terkunci, data sintetis, `npm run check`, tanpa kata "cap" di UI, `min-h-12`, trailer commit, branch `claude/great-cerf-8hwfjk`, CI manual).
- Harga tambahan terkunci: `DEEP_REVIEW/FREE` 200000, `DEEP_REVIEW/MEMBER` 150000 (integer IDR); tanpa diskon "pertama"; membership Rp19.000 terpisah dan tidak dicampur.
- Kelayakan = pemilik, review standar induk `COMPLETED` berhasil `WITH_NOTES`, laporan `FINAL`, verifikasi `LEGAL` induk `ACTIVE`, ≥ 1 catatan `PUBLISHED` yang `actionable`, hash `canonical_text` versi = `version_sha256` induk, belum ada deep live/selesai untuk induk itu. Catatan informasi saja tidak dihitung; AI tidak dihitung. Pembelian deep tanpa induk memenuhi syarat ditolak di DB (tidak ada bypass URL/API).
- Quote = order: harga, plan, induk, dan hash terikat di `price_snapshot`; berlaku 24 jam (default rekayasa); kedaluwarsa berarti order baru dengan harga baru. Kelayakan dicek ulang di transaksi pembuatan order dan di transaksi settlement; bila tidak lagi layak saat settlement → `RECONCILIATION_REQUIRED`, pembayaran `DISPUTED`, tanpa pekerjaan dan tanpa verifikasi.
- Laporan standar dan catatannya tidak pernah diubah; disposisi tiap catatan induk dicatat di laporan deep.
- Rubrik M1–M7 (usulan, `docs/DEEP_REVIEW.md`): M4, M6, M7 wajib dan tidak boleh `N_A`. `PASS` wajib bukti. Rubrik harus berstatus disetujui mitra (`rubric_approvals`) agar Enhanced dapat terbit; tanpa baris itu tidak ada Enhanced.
- Penjaga APPROVE (semua dalam satu transaksi): penugasan aktif, otoritas aktif, bukan pemilik, status `IN_REVIEW`, revisi cocok, atestasi eksplisit, hash cocok, pembayaran `VERIFIED`, verifikasi induk `ACTIVE`, pekerjaan tambahan tercatat, rubrik disetujui, checklist lengkap tanpa `FAIL`/`UNKNOWN`, bukti ada, setiap catatan aktionabel induk punya disposisi dan tidak ada `UNRESOLVED`/`OUT_OF_SCOPE` pada catatan MATERIAL/CRITICAL. Keputusan lain (`DENY`, `INCONCLUSIVE`, `REFER_SPECIAL`) wajib alasan, menyelesaikan pekerjaan, dan tidak menerbitkan apa pun.
- Pencabutan verifikasi induk: Enhanced turunan menjadi `SUSPENDED` dan deep yang belum selesai menjadi `ON_HOLD`. Pencabutan Enhanced tidak mencabut induk. Tidak ada jalur reinstate di fase ini.
- Kebijakan refund/kredit untuk deep yang tidak menghasilkan Enhanced **UNKNOWN**; tidak ada refund otomatis (laporan tetap diberikan).
- Enhanced tidak pernah terbit karena pembayaran, AI, atau admin. Admin hanya merutekan/menyetujui rubrik atas nama mitra yang tercatat (referensi persetujuan wajib, diaudit).

## Review Focus

1. Dua order deep serentak untuk induk yang sama; order kedaluwarsa membuka kembali; callback ganda tidak membuat dua pekerjaan. (Task 1–2)
2. Setiap penjaga negatif di `tests/policy-vectors.json` (`enhanced_negative_guards`) mencegah Enhanced dan tidak meninggalkan verifikasi. (Task 3)
3. Induk dicabut/ditangguhkan sebelum settlement atau sebelum keputusan: tidak ada pekerjaan/Enhanced; Enhanced yang sudah terbit menjadi `SUSPENDED`. (Task 2–3)
4. Pemilik hanya melihat laporan deep `FINAL`; catatan kerja/draf checklist tidak bocor; halaman publik Enhanced hanya memuat bidang minimal. (Task 4–5)
5. Flag OFF: tidak ada penawaran, pembelian lewat API generik, atau penerbitan. (Task 4)

## Tasks

### Task 1: Harga, kelayakan, dan order deep (DB)
**Files:** Create `supabase/migrations/20261016000022_deep_review.sql`, `tests/db/deep-orders.test.ts`. Modify (dalam migrasi): constraint `price_catalog.kind`/`orders.kind`, `quote_price`, `create_order`, `preview_price`.
**Interfaces:** Produces `deep_eligibility(p_user uuid, p_parent uuid, p_now timestamptz) returns table(eligible boolean, reason text)` dengan alasan `NOT_FOUND|PARENT_NOT_COMPLETED|NO_ACTIONABLE_NOTES|PARENT_NOT_ACTIVE|VERSION_MISMATCH|DEEP_EXISTS|OK`; `create_order(p_user, 'DEEP_REVIEW', p_ref := parent review_request id, ...)` memakai `deep_eligibility`, menolak dengan `NOT_ELIGIBLE: <reason>`; harga `DEEP_REVIEW/FREE|MEMBER` berdasarkan membership aktif saat order; indeks unik parsial satu order deep live per induk.
- [ ] Tes gagal dulu: vektor harga (Free 200000, Member aktif 150000, Member kedua tetap 150000 — tanpa diskon pertama); kelayakan lima vektor `policy-vectors.json` (IN_REVIEW, 0 catatan aktionabel, induk tidak aktif, hash beda → tidak layak; layak → order); catatan informasi non-aktionabel tidak cukup; pemilik lain → `NOT_FOUND`; dua order serentak → satu order, satu `DEEP_EXISTS`; order kedaluwarsa membuka kembali; kunci idempoten sama → order sama.
- [ ] Implement, hijaukan, commit `feat(db): deep review price, eligibility, and orders`.

### Task 2: Settlement, permintaan deep, dan penugasan (DB)
**Files:** Same migration; `tests/db/deep-requests.test.ts`.
**Interfaces:** Produces tabel `deep_requests(id, parent_request_id, order_id unique, owner_id, version_id, version_sha256, firm_id, status check in ('QUEUED','IN_REVIEW','READY_FOR_DECISION','COMPLETED','CANCELLED','ON_HOLD'), outcome check in ('ENHANCED_APPROVED','COMPLETED_WITH_NOTES','INCONCLUSIVE','REFERRED_SPECIAL_CASE'), created_at, completed_at)` (unik parsial satu live/selesai per induk), `deep_assignments(...)`; `fulfill_order` untuk `DEEP_REVIEW` memanggil `create_deep_request(p_order, p_now)`; `settle_payment` (create or replace) mengalihkan ke `RECONCILIATION_REQUIRED` bila `deep_eligibility` (mengabaikan permintaan sendiri) gagal; `assign_deep(p_actor, p_deep, p_reviewer, p_now)` / `reassign_deep` dengan aturan yang sama seperti review standar (koordinator firma/admin, otoritas, bukan pemilik, kapasitas 10 total standar+deep); `deep_queue(p_reviewer)`.
- [ ] Tes gagal dulu: settlement membuat tepat satu `QUEUED` dengan hash induk; callback ganda → satu; induk dicabut sebelum settlement → `RECONCILIATION_REQUIRED` tanpa deep; jumlah salah/kedaluwarsa → tanpa deep; penugasan oleh koordinator firmanya sukses, aktor lain `FORBIDDEN`, reviewer tak berwenang/pemilik `REVIEWER_NOT_AUTHORIZED`, kapasitas menghitung standar+deep; `revoke_verification` induk → deep `QUEUED`/`IN_REVIEW` menjadi `ON_HOLD` dan Enhanced turunan `SUSPENDED` (fungsi diganti dalam migrasi ini).
- [ ] Implement, hijaukan, commit `feat(db): deep review requests, settlement guard, assignment, revocation cascade`.

### Task 3: Laporan deep, checklist, disposisi, dan keputusan (DB)
**Files:** Create `supabase/migrations/20261016000023_deep_decision.sql`, `tests/db/deep-decision.test.ts`.
**Interfaces:** Produces `rubric_approvals(policy_version text pk, signoff_ref text not null, approved_by uuid, approved_at)` + `admin_approve_rubric(p_admin, p_version, p_signoff_ref, p_now)` (hanya `platform_admin`, diaudit, `signoff_ref` min 3 karakter); `deep_reports(id, deep_id unique, revision, status check in ('DRAFT','FINAL'), extra_work, summary, decision check in ('APPROVE','DENY','INCONCLUSIVE','REFER_SPECIAL'), decision_reason, author_id, finalized_at)`; `deep_dispositions(report_id, parent_note_no, disposition check in ('RESOLVED','ACCEPTED_RISK','UNRESOLVED','OUT_OF_SCOPE'), evidence)`; `deep_checklist(report_id, item check in ('M1'..'M7'), result check in ('PASS','FAIL','UNKNOWN','N_A'), reasoning, evidence_ref, policy_version, assessed_at)`; trigger tolak ubah baris `FINAL`; `start_deep(p_reviewer, p_deep, p_now)` (penugasan+otoritas+hash; mengembalikan teks versi dan catatan induk `PUBLISHED`), `save_deep_draft(p_reviewer, p_deep, p_revision, p_extra_work, p_summary, p_now)`, `set_disposition(...)`, `set_checklist(...)` (semua `STALE_REVISION` bila revisi basi; `N_A` untuk M4/M6/M7 ditolak), `decide_deep(p_reviewer, p_deep, p_revision, p_decision, p_reason, p_attest, p_now) returns table(outcome text, verification_id uuid, code text)` dengan semua penjaga Global Constraints; APPROVE menerbitkan `LEGAL_ENHANCED` (`parent_verification_id` = verifikasi induk, `request_id` = permintaan induk, `issuer` memuat firma dan reviewer) dan outbox `review_completed`; `get_deep_for_owner(p_user, p_deep)`.
- [ ] Tes gagal dulu, satu tes per penjaga negatif: `PAYMENT_ONLY` (tanpa pekerjaan tambahan), `NO_EXTRA_WORK`, `UNAUTHORIZED_REVIEWER` (dicabut di tengah jalan; reviewer lain; koordinator; admin; pemilik), `MATERIAL_FAIL`, `MATERIAL_UNKNOWN`, `MISSING_EVIDENCE`, `UNRESOLVED_MATERIAL_NOTE`, `NO_ATTESTATION`, `STALE_HASH`, `REVOKED_PARENT`, `UNAPPROVED_RUBRIC`; checklist tidak lengkap; disposisi hilang; sukses penuh menerbitkan tepat satu Enhanced (hash = hash versi; induk tetap `ACTIVE`); panggilan ganda idempoten; `DENY`/`INCONCLUSIVE`/`REFER_SPECIAL` tanpa alasan ditolak dan dengan alasan menyelesaikan tanpa verifikasi; laporan `FINAL` tak dapat diubah; draf tidak terlihat pemilik; non-admin `admin_approve_rubric` → `FORBIDDEN`; `authenticated` tidak dapat memanggil fungsi atau membaca tabel.
- [ ] Implement, hijaukan, commit `feat(db): deep report, checklist, dispositions, and guarded Enhanced issuance`.

### Task 4: Layanan, handler, flag, dan API
**Files:** Create `src/lib/deep/{service,handlers}.ts`, `src/app/api/deep/**`, `src/app/api/partner/deep/**`, `tests/db/deep-handlers.test.ts`; Modify `src/lib/flags.ts` (`deepReviewPurchase`, `enhancedIssuance`), `src/lib/billing/{service,handlers}.ts` (kind `DEEP_REVIEW`, `parentRequestId`, `NOT_ELIGIBLE` 409), `src/lib/auth/permissions.ts` (`/api/deep`, `/api/partner` sudah), `.env.example`.
**Interfaces:** `createPgDeepService(pool)`: pemilik `eligibility(userId, parentId)`, `getForOwner(userId, deepId)`; reviewer `queue`, `open`, `saveDraft`, `setDisposition`, `setChecklist`, `decide`; koordinator `assign`. Handler berinjeksi dengan `flags: { deepReviewPurchase: boolean; enhancedIssuance: boolean }`: flag pembelian OFF → `/api/orders` dengan `DEEP_REVIEW` dan `/api/deep/eligibility` menjawab 404 `FEATURE_DISABLED`; flag Enhanced OFF → keputusan `APPROVE` ditolak 409 `ENHANCED_DISABLED` sebelum menyentuh DB (keputusan lain tetap boleh). Kode galat: seperti Fase 3 ditambah `NOT_ELIGIBLE` 409 (dengan `reason`), `DEEP_EXISTS` 409.
- [ ] Tes gagal dulu: flag OFF 404/409; anonim 401; pemilik lain 404 identik; reviewer bukan penugasan 404; admin/koordinator/pemilik tidak dapat memutuskan (403); harga klien diabaikan; eligibility mengembalikan alasan dan harga; keputusan non-APPROVE tetap bekerja dengan flag Enhanced OFF.
- [ ] Implement, hijaukan, commit `feat(deep): service, handlers, flags, and API`.

### Task 5: Halaman pemilik, editor mitra, persetujuan rubrik, dan verifikasi akhir
**Files:** Create `src/components/deep/{deep-offer,deep-result}.tsx`, `src/app/(partner)/partner/deep/[id]/page.tsx`, `src/app/(partner)/partner/deep-actions.ts`, `src/app/(admin)/admin/rubric/{page,actions}.tsx`, `tests/unit/deep-ui.test.ts`; Modify `src/app/(app)/reviews/[id]/page.tsx`, `src/lib/copy.ts`, `README.md`, `.env.example`, `PACKAGE_MANIFEST.json`.
**Interfaces:** `DeepOffer({ eligibility, quote })` hanya dirender bila layak dan flag aktif: harga tambahan, rumus total (Free Rp250.000; Member pertama Rp180.000; Member berikutnya Rp185.000, tanpa membership), pernyataan `CHECKOUT_NOTE`, tidak menjanjikan Enhanced; `DeepResult({ result })` menampilkan hasil nyata (`Enhanced disetujui`, `Selesai dengan catatan`, `Belum dapat disimpulkan`, `Dirujuk sebagai kasus khusus`), disposisi tiap catatan, pernyataan wajib Enhanced hanya bila terbit, dan teks bahwa pembayaran tidak menjamin hasil.
- [ ] Tes gagal dulu: komponen (teks status, harga, tanpa "cap", `min-h-12`, pernyataan wajib); `npm run check`, `npm run build`, `grep -rniE "\bcap\b" src` kosong, `grep -n "insert into public.document_verifications" supabase/migrations` hanya `issue_ai_verification`, `publish_standard`, `decide_deep`; validator paket PASS.
- [ ] Implement, hijaukan, review akhir oleh reviewer baru, perbaiki Critical/Important dengan TDD, push.

## Self-review

- **Cakupan:** kelayakan dan harga (T1), settlement/penugasan/pencabutan berantai (T2), checklist/disposisi/penjaga/Enhanced (T3), API+flag (T4), UI+rubrik+verifikasi (T5).
- **Ditunda:** Fase 5 (ops admin, analitik, rekonsiliasi, smoke rilis), UI admin firma/otorisasi, gateway nyata, kebijakan refund.
- **UNKNOWN:** persetujuan rubrik mitra (produksi OFF sampai ada), kebijakan refund/kredit deep, blok triase kasus khusus (tidak ada sumber data; dicatat sebagai celah), pembukaan kembali permintaan yang ditutup.

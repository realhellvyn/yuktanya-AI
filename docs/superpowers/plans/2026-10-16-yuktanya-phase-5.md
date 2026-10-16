# Yuktanya Phase 5 Implementation Plan — Operasional Admin, Rekonsiliasi, dan Smoke Rilis

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline, native). Steps use checkbox syntax.

**Goal:** Platform admin dapat melihat angka bisnis yang jujur (pendapatan hanya dari pembayaran terverifikasi, funnel, antrean review, AI, insiden), mengelola firma dan otorisasi profesional, menyelesaikan rekonsiliasi pembayaran dengan jejak audit, dan pemilik dapat menjalankan smoke rilis yang menguji kontrak kritis tanpa browser.

**Architecture:** Metrik dihitung di SQL dari tabel sumber kebenaran (orders, payments, review_requests, deep_requests, memberships, document_versions, product_events untuk AI), bukan dari event yang disuntik klien. Setiap fungsi admin memeriksa `platform_admin` dan menulis audit. Tidak ada angka fiktif: tanpa data berarti `null` ditampilkan sebagai "Belum ada data".

**Tech Stack:** Next.js, Postgres, vitest.

**Spec:** `docs/ADMIN_DASHBOARD.md`, `docs/TEST_STRATEGY.md`, `tests/e2e/SCENARIOS.md`, `docs/DELIVERY_PLAN.md`; Fase sebelumnya `...-phase-3.md`, `...-phase-4.md`.

## Global Constraints

- Semua Global Constraints Fase 3 dan 4 berlaku.
- Hanya `platform_admin` (rute `/admin/**`, `/api/admin/**`, dan semua fungsi SQL admin). Reviewer dan pengguna ditolak. Admin tidak pernah membaca isi dokumen atau catatan privat lewat modul ini; agregat tidak memuat nama pihak, teks dokumen, atau prompt.
- Zona waktu semua rentang: Asia/Jakarta. Rentang default: 7 hari terakhir; pilihan 1/7/30 hari.
- Pendapatan = jumlah `payments.status = 'VERIFIED'` per jenis order, dikurangi `REFUNDED`; diberi label "dikumpulkan", bukan laba; biaya transaksi (`fee_idr`) ditampilkan terpisah; margin kotor hanya bila biaya tercatat, selain itu "Belum ada data". Membership ditulis "pendapatan membership bulanan", bukan MRR (perpanjangan manual).
- Funnel memakai kohort tetap dengan penyebut yang diberi label: terdaftar → pernah memakai AI → dokumen dimulai → versi dibuat → review diminta → review dibayar → review selesai.
- Latensi AI P50/P95 dari `product_events` (`ai_request_succeeded`, `latency_ms`); tanpa prompt.
- Rekonsiliasi: admin memilih `ACTIVATE` (hanya bila order dan kelayakan masih valid, memakai `fulcill` normal), `REFUND_RECORDED` (mencatat bahwa pengembalian dana dilakukan di luar sistem; payment `REFUNDED`, order `CANCELLED`, entitlement dilepas), atau `CLOSE`; catatan wajib; semuanya diaudit. Tidak ada pengembalian dana otomatis (kebijakan refund UNKNOWN).
- Smoke rilis: enam skenario E01, E02, E03, E08, E13, E14 dijalankan lewat handler/DB (tanpa browser, tanpa jaringan) oleh `npm run test:smoke`, **bukan** bagian `npm run check`; E04, E05, E09, E10, E11 ditambahkan karena wajib sebelum flag Deep/Enhanced dinyalakan. E06, E07, E12, E15–E18 tetap dicakup tes DB/unit yang ada dan tidak diulang.

## Review Focus

1. Pendapatan tidak pernah menghitung order tanpa pembayaran `VERIFIED`, pembayaran `DISPUTED`/`REFUNDED`, atau order Rp0/kredit; pembagian per jenis menjumlah ke total. (Task 1)
2. Admin non-`platform_admin` (reviewer, koordinator, pengguna, anonim) ditolak di setiap rute dan fungsi; tidak ada kebocoran isi dokumen di agregat. (Task 1–3)
3. Rekonsiliasi `ACTIVATE` tidak mengaktifkan order yang sudah tidak layak atau yang sudah dipenuhi; `REFUND_RECORDED` tidak dapat dua kali. (Task 2)
4. Data kosong ditampilkan sebagai "Belum ada data", bukan 0. (Task 1, 3)
5. Smoke gagal bila satu penjaga (login-sebelum-AI, peran, hash, settlement, pencabutan, kuota) diputus. (Task 5)

## Tasks

### Task 1: Metrik admin (DB)
**Files:** Create `supabase/migrations/20261016000025_admin_metrics.sql`, `tests/db/admin-metrics.test.ts`.
**Interfaces:** Produces `admin_overview(p_admin uuid, p_from timestamptz, p_to timestamptz) returns jsonb` dengan kunci: `users {registered, new, activated}`, `ai {requests, succeeded, failed, p50_ms, p95_ms}`, `documents {started, versions}`, `funnel {registered, ai_used, doc_started, version_created, review_requested, review_paid, review_completed}`, `reviews {backlog_by_age {lt_24h, d1_3, gt_3d}, unassigned, sla_median_hours, sla_p95_hours, completed}`, `revenue {collected_by_kind {...}, refunds, net, fees, memberships_active}`, `incidents {reconciliation, failed_outbox, ai_failures}`; nilai tanpa data = `null`. `admin_find_user(p_admin, p_email) returns uuid`.
- [ ] Tes gagal dulu: non-admin → `FORBIDDEN`; basis data dengan order PAID tanpa pembayaran `VERIFIED` tidak menambah pendapatan; DISPUTED/REFUNDED tidak dihitung/ dikurangi; pembagian jenis menjumlah ke total; rentang WIB (batas tengah malam); funnel menghitung pengguna unik; tidak ada data → `null` bukan 0; hasil tidak memuat teks dokumen.
- [ ] Implement, hijaukan, commit.

### Task 2: Rekonsiliasi dan manajemen mitra (DB)
**Files:** Create `supabase/migrations/20261016000026_admin_ops.sql`, `tests/db/admin-ops.test.ts`.
**Interfaces:** Produces `admin_resolve_reconciliation(p_admin uuid, p_order uuid, p_action text, p_note text, p_now timestamptz) returns text` (`ACTIVATED|REFUND_RECORDED|CLOSED`; hanya order `RECONCILIATION_REQUIRED`; catatan min 5 karakter; diaudit); `admin_list_partners(p_admin uuid)` mengembalikan firma, anggota (id, peran), otorisasi (aktif/kedaluwarsa/dicabut).
- [ ] Tes gagal dulu sesuai Review Focus 3, non-admin `FORBIDDEN`, audit tercatat, `ACTIVATE` pada order deep yang induknya dicabut ditolak.
- [ ] Implement, hijaukan, commit.

### Task 3: Dashboard admin dan manajemen mitra (UI)
**Files:** Create `src/lib/admin/{service,format}.ts`, `src/app/(admin)/admin/{analytics,reviews,revenue,ai-usage,users,incidents,partners}/page.tsx` + `actions.ts` untuk `partners` dan rekonsiliasi di `payments`, `src/components/admin/{kpi-card,date-range,range}.tsx`, `tests/unit/admin-ui.test.ts`; Modify `src/app/(admin)/admin/page.tsx`.
**Interfaces:** `parseRange(q: { r?: string }, now?: Date): { from: Date; to: Date; label: string }` (1/7/30 hari, WIB); `KpiCard({ label, value, hint })` menampilkan "Belum ada data" untuk `null`; `formatIdr` untuk uang.
- [ ] Tes gagal dulu: `parseRange` (default 7 hari, batas WIB, nilai ngawur → default), `KpiCard` null → "Belum ada data" dan 0 → "0", label pendapatan memakai "dikumpulkan" dan tidak memuat "laba"/"MRR", `min-h-12`, tanpa "cap".
- [ ] Implement, `npm run build`, commit.

### Task 4: Telemetri event yang kurang
**Files:** Modify jalur server yang menyelesaikan transisi (settlement, publish, issue) agar menulis event idempoten lewat DB (`product_events` dari dalam fungsi SQL: `payment_verified`, `review_completed`, `verification_issued`, `verification_revoked`), `tests/db/telemetry.test.ts`.
- [ ] Tes gagal dulu: settlement ganda → satu event; publish → event tanpa teks; event tidak berisi PII. Implement, hijaukan, commit.

### Task 5: Smoke rilis dan verifikasi akhir
**Files:** Create `tests/smoke/{auth-roles,standard,billing,verification,quota,deep}.test.ts`, `vitest.smoke.config.ts`, `scripts/db/with-test-db.sh` (dipakai ulang); Modify `package.json` (`test:smoke`), `README.md`, `docs/RELEASE_CHECKLIST.md` (baru), `PACKAGE_MANIFEST.json`.
- [ ] Tulis keenam skenario wajib (E01, E02, E03, E08, E13, E14) ditambah E04, E05, E09, E10, E11 menurut `tests/e2e/SCENARIOS.md`, masing-masing menegaskan keadaan backend. Jalankan `npm run test:smoke` sekali; catat hasil nyata. `npm run check` dan `npm run build` sekali; `grep -rniE "\bcap\b" src` kosong; validator PASS.
- [ ] Review akhir oleh reviewer baru, perbaiki Critical/Important dengan TDD, push.

## Self-review
- **Cakupan:** metrik jujur (T1), rekonsiliasi+mitra (T2), UI (T3), telemetri (T4), smoke+rilis (T5).
- **UNKNOWN:** penyedia email/gateway/hosting, kebijakan refund, SLA target, biaya AI/mitra untuk margin, persetujuan rubrik/template/privasi (blocker produksi di luar kode), verifikasi adapter Supabase Storage.

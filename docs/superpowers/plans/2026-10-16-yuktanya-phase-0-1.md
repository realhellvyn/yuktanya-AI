# Yuktanya Phase 0–1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fondasi aplikasi (Next.js, Supabase Auth/RLS, tiga dashboard shell, landing/pricing) plus gateway AI server-only `model: "auto"` dengan kuota atomik WIB dan mock mode.

**Architecture:** Modular monolith Next.js. Logika uang/kuota/hak hidup sebagai fungsi SQL (Postgres) yang dipanggil server dengan koneksi `DATABASE_URL`; TypeScript hanya membungkus dan memvalidasi. Tes DB berjalan di Postgres 16 lokal sementara (bukan Docker/Supabase CLI), dengan stub skema `auth`.

**Tech Stack:** Next.js (App Router) + TypeScript strict, Tailwind + shadcn/ui, `@supabase/ssr`, `pg`, `zod`, Vitest. Postgres 16 tersedia di `/usr/lib/postgresql/16/bin` (diperiksa 16 Okt 2026).

**Spec:** `docs/superpowers/specs/2026-10-16-yuktanya-v8-extension-design.md` (dan blueprint v8: `docs/IMPLEMENTATION_GUIDE.md`, `AI_FAIR_USAGE.md`, `PERMISSIONS.md`, `DATA_MODEL.md`, `ARCHITECTURE.md`).

## Global Constraints

- UI Bahasa Indonesia sederhana; harga ditulis `Rp50.000` (titik ribuan); uang disimpan integer IDR.
- Harga terkunci: membership Rp19.000; standar Free Rp50.000 / Member pertama Rp30.000 / berikutnya Rp35.000; Deep tambahan Rp200.000 (Free) / Rp150.000 (Member).
- Kuota per hari WIB: Free 20 pesan / 1 dokumen baru / 2 AI review; Member aktif 60 / 5 / 10. Setiap AI review sukses juga memakai 1 pesan. Reset 00.00 Asia/Jakarta. Reservasi atomik + idempotensi + lepas saat gagal.
- Login/register wajib sebelum AI apa pun. Setiap panggilan LLM server-only, literal `model: "auto"`, tanpa pemilih model atau env override.
- Hak/harga/kuota ditentukan server/DB; klien tidak pernah mengirim plan, user_id, timezone, atau role yang dipercaya. Peran tidak pernah dari metadata yang dapat diedit user.
- Order `pending` tidak memberi hak Member. Fixture membership hanya untuk tes dan tidak mengaktifkan hak produksi.
- Flag default OFF: `AI_PREREVIEW_ENABLED`, `DEEP_REVIEW_PURCHASE`, `ENHANCED_ISSUANCE`.
- Hanya data sintetis; tidak ada dokumen hukum nyata, deployment, atau pembayaran sungguhan.
- CI: hanya `workflow_dispatch` sampai kuota Actions reset (~1 Nov 2026). Pemeriksaan harian = `npm run check`. Tidak ada Playwright/E2E di fase ini; E01/E02/E14 dicakup tes integrasi API/DB. Laporkan hanya tes yang benar-benar dijalankan.
- Setiap pesan commit diakhiri dua baris:
  `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` dan
  `Claude-Session: https://claude.ai/code/session_016B7SX6nyHrmjD4FoWDsi9m`
- Nilai default rekayasa (bukan keputusan pemilik, ditandai di kode): TTL reservasi yatim 300 detik; maksimal 2 percobaan perbaikan JSON.
- Branch kerja: `claude/great-cerf-8hwfjk`.

## Review Focus

1. `returnTo` berbahaya (`//evil.com`, `https://evil.com`, `javascript:`) → jatuh ke `/dashboard`. (Task 5)
2. Klien mengirim header/body `plan: MEMBER` atau `user_id` orang lain → diabaikan; kuota tetap Free. (Task 12)
3. Dua permintaan bersamaan saat sisa kuota 1 → tepat satu berhasil. (Task 9)
4. Batas hari: 16:59:59Z (23:59:59 WIB) vs 17:00:00Z (00:00 WIB) harus beda hari. (Task 9)
5. Gateway membalas non-JSON/HTML/`choices` kosong/payload raksasa → tanpa biaya kuota, input user tetap tersimpan, error bertipe. (Tasks 11–13)

## File Structure

```
package.json, tsconfig.json, next.config.ts, vitest.config.ts, .github/workflows/check.yml
scripts/db/with-test-db.sh        # cluster Postgres sementara + migrasi + jalankan perintah
supabase/migrations/2026101600000{1,2,3,4}_*.sql
tests/db/{bootstrap.sql,helpers.ts,*.test.ts}   tests/unit/*.test.ts
src/lib/pricing/catalog.ts        # satu sumber angka harga/kuota di TS
src/lib/auth/permissions.ts       # peran, capability, guardPath, safeReturnTo
src/lib/supabase/{server,browser}.ts   src/middleware.ts
src/lib/ai/{gateway,quota,interview,handle-chat}.ts   src/lib/flags.ts   src/lib/analytics/events.ts
src/app/(public)/{page,pricing/page}.tsx  src/app/(auth)/{login,register}/page.tsx
src/app/(app)/dashboard/page.tsx  src/app/(partner)/partner/page.tsx  src/app/(admin)/admin/page.tsx
src/app/api/{usage,ai/chat}/route.ts
```

---

### Task 1: Scaffold, skrip `check`, dan workflow manual

**Files:** Create `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `.github/workflows/check.yml`, `tests/unit/smoke.test.ts`; Modify `README.md` (bagian "Menjalankan lokal"), `.env.example` (tambah `DATABASE_URL=`).

**Interfaces:** Produces: skrip `npm run check` = `lint && typecheck && test:unit && test:db`; `test:unit` = `vitest run tests/unit`; `test:db` = `bash scripts/db/with-test-db.sh vitest run tests/db`.

- [ ] **Step 1:** Scaffold Next.js App Router + TypeScript `strict: true` + Tailwind + shadcn/ui di root repo (tanpa menimpa `docs/`, `CLAUDE.md`, `.env.example`); tambah `pg`, `zod`, `@supabase/ssr`, `server-only`, `vitest`.
- [ ] **Step 2: Failing test** `tests/unit/smoke.test.ts`: `it("strict mode on")` membaca `tsconfig.json` dan `expect(cfg.compilerOptions.strict).toBe(true)`. Jalankan `npx vitest run tests/unit/smoke.test.ts` → FAIL sebelum `tsconfig` strict ada.
- [ ] **Step 3:** Set `strict: true`; tambah skrip di atas; `.github/workflows/check.yml` dengan `on: workflow_dispatch` saja (checkout, setup-node dengan cache npm, `npm ci`, `npm run check`; satu job; `concurrency` dengan `cancel-in-progress: true`). Catat di README: ketersediaan Postgres 16 di runner **belum diverifikasi**, cek saat run manual pertama.
- [ ] **Step 4:** `npm run lint && npm run typecheck && npm run test:unit` → PASS (`test:db` ditambahkan di Task 2).
- [ ] **Step 5: Commit** `chore: scaffold Next.js strict TS, check script, manual-only workflow`.

### Task 2: Harness tes DB (Postgres 16 sementara + stub `auth`)

**Files:** Create `scripts/db/with-test-db.sh`, `tests/db/bootstrap.sql`, `tests/db/helpers.ts`, `tests/db/harness.test.ts`.

**Interfaces:** Produces: env `TEST_DATABASE_URL`; `helpers.ts`: `getPool(): Pool`; `createUser(pool: Pool, opts?: { roles?: Role[]; meta?: object }): Promise<string>` (insert ke `auth.users`, mengembalikan uuid); `asUser<T>(pool: Pool, userId: string, fn: (c: PoolClient) => Promise<T>): Promise<T>` (transaksi, `set local role authenticated`, `set local request.jwt.claims` berisi `sub`); `asService` analog untuk `service_role`.

- [ ] **Step 1: Failing test** `harness.test.ts`: `it("auth.uid() mengikuti claims asUser")` → `expect(row.uid).toBe(userId)`; `it("anon tidak punya uid")` → `expect(row.uid).toBeNull()`.
- [ ] **Step 2:** `npx vitest run tests/db/harness.test.ts` → FAIL (skrip belum ada).
- [ ] **Step 3:** `with-test-db.sh`: `initdb` + `pg_ctl` di direktori sementara (`/usr/lib/postgresql/16/bin`, port acak, socket di dir sementara), jalankan `bootstrap.sql` (skema `auth`, tabel `auth.users(id uuid, email text, raw_user_meta_data jsonb)`, fungsi `auth.uid()` membaca `current_setting('request.jwt.claims', true)::jsonb->>'sub'`, role `anon`, `authenticated`, `service_role`), lalu semua `supabase/migrations/*.sql` berurutan, ekspor `TEST_DATABASE_URL`, jalankan argumen sisa, matikan klaster di `trap EXIT`. Gagal keras (exit ≠ 0) bila Postgres tidak ada; tidak boleh skip diam-diam.
- [ ] **Step 4:** Tambah `test:db` ke `package.json`; jalankan `npm run test:db` → PASS (2 tes).
- [ ] **Step 5: Commit** `test: add ephemeral Postgres harness with auth stub`.

### Task 3: Skema inti + RLS default-deny

**Files:** Create `supabase/migrations/20261016000001_core.sql`, `tests/db/core.test.ts`.

**Interfaces:** Produces tabel `profiles(id uuid pk → auth.users, display_name text, utm_source text, utm_campaign text, utm_creative text, created_at timestamptz)`, `user_roles(user_id, role text check in ('user','reviewer','partner_admin','platform_admin'), granted_by uuid, created_at, pk(user_id, role))`, `audit_events(id, actor_id, event_type, entity_type, entity_id, metadata_safe jsonb, created_at)`, `product_events(id, actor_user_id, event_name, entity_type, entity_id, dedupe_key text unique, occurred_at, metadata_safe jsonb)`; trigger `on_auth_user_created` mengisi `profiles` dan memberi **hanya** role `user`.

- [ ] **Step 1: Failing tests** (`core.test.ts`): `it("signup dengan meta role=platform_admin tetap hanya 'user'")` → roles `['user']`; `it("user A tidak bisa membaca profil user B")` → 0 baris; `it("user tidak bisa insert/update/delete user_roles, termasuk miliknya")` → error `42501` atau 0 baris terdampak; `it("audit_events tertutup untuk authenticated")`; `it("audit_events append-only bahkan untuk service_role")` → UPDATE/DELETE error; `it("product_events dedupe_key unik")`.
- [ ] **Step 2:** `npm run test:db` → FAIL.
- [ ] **Step 3:** Tulis migrasi: RLS aktif di semua tabel; `profiles` SELECT/UPDATE own (hanya kolom `display_name`, `utm_*` boleh diubah lewat fungsi, bukan UPDATE langsung); `user_roles`/`audit_events`/`product_events` tanpa kebijakan untuk `authenticated`; trigger `BEFORE UPDATE OR DELETE` pada `audit_events` yang `RAISE EXCEPTION`.
- [ ] **Step 4:** `npm run test:db` → PASS.
- [ ] **Step 5: Commit** `feat(db): core schema with default-deny RLS and append-only audit`.

### Task 4: Konstanta harga/kuota (satu sumber TS)

**Files:** Create `src/lib/pricing/catalog.ts`, `tests/unit/catalog.test.ts`.

**Interfaces:** Produces `type PlanKey = "FREE" | "MEMBER"`; `PRICING` (`membershipMonthlyIdr: 19000`; `standard: { free: 50000, memberFirst: 30000, memberLater: 35000 }`; `deepAdditional: { free: 200000, member: 150000 }`); `QUOTAS: Record<PlanKey, { messages: number; documents: number; aiReviews: number }>`; `formatIdr(n: number): string`.

- [ ] **Step 1: Failing test:** `formatIdr(50000)` → `"Rp50.000"`; `formatIdr(19000)` → `"Rp19.000"`; `QUOTAS` sama dengan `tests/policy-vectors.json` (`FREE` 20/1/2, `MEMBER_ACTIVE` 60/5/10); total harga dari `policy-vectors.json` (`service_total`) sama dengan `standard + deepAdditional` untuk FREE (250000), MEMBER pertama (180000), MEMBER berikutnya (185000).
- [ ] **Step 2:** `npx vitest run tests/unit/catalog.test.ts` → FAIL.
- [ ] **Step 3:** Implementasi `formatIdr` dengan `Intl.NumberFormat("id-ID")` (pastikan keluaran tanpa spasi `Rp` + angka bertitik).
- [ ] **Step 4:** Tes PASS. **Step 5: Commit** `feat: pricing and quota constants verified against policy vectors`.

### Task 5: Izin, guard rute, dan `safeReturnTo`

**Files:** Create `src/lib/auth/permissions.ts`, `tests/unit/permissions.test.ts`.

**Interfaces:** Produces `type Role = "user"|"reviewer"|"partner_admin"|"platform_admin"`; `homeFor(roles: Role[]): "/dashboard"|"/partner"|"/admin"` (prioritas admin > partner > dashboard); `guardPath(pathname: string, roles: Role[] | null): { allow: true } | { allow: false; redirect: string }`; `safeReturnTo(raw: string | null | undefined): string`.

- [ ] **Step 1: Failing tests:** anonim ke `/dashboard`,`/partner`,`/admin`,`/api/ai/chat` → `allow:false`, redirect `/login?returnTo=...` (API → status 401 ditangani Task 12); `user` ke `/admin` → redirect `/dashboard`; `reviewer` dan `partner_admin` ke `/partner` → allow, ke `/admin` → redirect `/partner`; `platform_admin` ke `/partner` → redirect `/admin` (tanpa warisan); `reviewer` ke `/dashboard` → redirect `/partner` (PERMISSIONS: dokumen sendiri hanya dengan identitas pemilik terpisah). `safeReturnTo`: `"/dashboard"` → sama; `"//evil.com"`, `"https://evil.com"`, `"javascript:alert(1)"`, `"/\\evil.com"`, `null`, `""` → `"/dashboard"`.
- [ ] **Step 2:** FAIL. **Step 3:** Implementasi fungsi murni; `safeReturnTo` hanya menerima path yang diawali satu `/` diikuti bukan `/` atau `\`.
- [ ] **Step 4:** PASS. **Step 5: Commit** `feat(auth): role guard and safe returnTo`.

### Task 6: Klien Supabase, middleware, login/register

**Files:** Create `src/lib/supabase/{server,browser}.ts`, `src/middleware.ts`, `src/app/(auth)/{login,register}/page.tsx`, `src/app/auth/callback/route.ts`, `tests/unit/attribution.test.ts`; Modify `src/lib/auth/permissions.ts` (ekspor `parseAttribution`).

**Interfaces:** Consumes `guardPath`, `safeReturnTo` (Task 5). Produces `parseAttribution(params: URLSearchParams): { utm_source?: string; utm_campaign?: string; utm_creative?: string }` (nilai dipangkas 100 karakter); `getSessionRoles(): Promise<{ userId: string; roles: Role[] } | null>` di `server.ts` (membaca `user_roles` lewat sesi, bukan metadata JWT).

- [ ] **Step 1: Failing test** `attribution.test.ts`: `parseAttribution(new URLSearchParams("utm_source=meta&utm_campaign=c1&utm_creative=v2&x=1"))` → hanya tiga kunci utm; nilai 300 karakter dipangkas 100; kunci tak dikenal dibuang.
- [ ] **Step 2:** FAIL. **Step 3:** Implementasi + halaman login/register (label "Daftar Gratis", "Masuk", tanpa jargon; field Wajib/Opsional; `returnTo` lewat `safeReturnTo`; UTM dari query disimpan ke cookie lalu ke `profiles` saat sinyal pendaftaran pertama via fungsi server). Middleware memanggil `guardPath` dengan peran dari `getSessionRoles`.
- [ ] **Step 4:** `npm run lint && npm run typecheck && npm run test:unit` → PASS. Verifikasi manual terarah: `npm run build` sukses.
- [ ] **Step 5: Commit** `feat(auth): supabase clients, middleware guard, login/register with attribution`.

### Task 7: Landing, pricing, dan tiga dashboard shell

**Files:** Create `src/app/(public)/page.tsx`, `src/app/(public)/pricing/page.tsx`, `src/app/(app)/dashboard/page.tsx`, `src/app/(partner)/partner/page.tsx`, `src/app/(admin)/admin/page.tsx`, `tests/unit/pricing-page.test.ts`.

**Interfaces:** Consumes `PRICING`, `formatIdr`. Produces halaman server component; `/pricing` merender tabel harga dari `PRICING`.

- [ ] **Step 1: Failing test:** render `/pricing` (komponen server dirender ke string) memuat `Rp19.000`, `Rp50.000`, `Rp30.000`, `Rp35.000`, `Rp200.000`, `Rp150.000`, dan teks `Biaya dan ruang lingkup ditentukan setelah asesmen profesional.`; **tidak** memuat tombol beli Deep mandiri.
- [ ] **Step 2:** FAIL. **Step 3:** Implementasi halaman: landing (judul "Buat dokumen hukum lebih mudah", slogan *Legal Service Seharga Secangkir Kopi.*, CTA "Daftar Gratis"); shell dashboard dengan sidebar/ tab berlabel; `/partner` dan `/admin` tampilan placeholder sadar peran tanpa data; label wajib "Dibuat dengan bantuan AI. Belum diperiksa oleh profesional hukum." disiapkan sebagai konstanta salinan.
- [ ] **Step 4:** PASS + `npm run build`. **Step 5: Commit** `feat(ui): landing, pricing, three role shells`.

### Task 8: Katalog produk, hak, dan `resolve_entitlement`

**Files:** Create `supabase/migrations/20261016000002_catalog.sql`, `tests/db/entitlement.test.ts`.

**Interfaces:** Produces tabel `products(key, kind)`, `product_grants(product_key, grant_key, int_value)`, `memberships(id, user_id, status check in ('PENDING','ACTIVE','EXPIRED','REVOKED'), period_start, period_end)`, `feature_plan_map(feature_key, plan)`; fungsi `public.resolve_entitlement(p_user uuid, p_now timestamptz) returns table(plan text, messages int, documents int, ai_reviews int, features text[])`. Seed: plan `FREE` 20/1/2, `MEMBER` 60/5/10; fitur `vault.reminders|share|evidence_pack|amend` **belum dipetakan ke plan mana pun** (default pemetaan belum diputuskan pemilik).

- [ ] **Step 1: Failing tests:** tanpa membership → `FREE` 20/1/2; `PENDING` → `FREE`; `ACTIVE` dengan `period_start <= now < period_end` → `MEMBER` 60/5/10; `EXPIRED` atau `now = period_end` → `FREE`; nilai seed sama dengan `QUOTAS` di `catalog.ts` (impor dan banding); `authenticated` tidak dapat INSERT/UPDATE `memberships`, `product_grants`, `feature_plan_map` (RLS/grant); `authenticated` tidak dapat `EXECUTE resolve_entitlement` sama sekali (hanya `service_role`).
- [ ] **Step 2:** FAIL. **Step 3:** Migrasi + `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated`; `GRANT EXECUTE` hanya ke `service_role`. Fungsi `SECURITY DEFINER`, `search_path` dikunci.
- [ ] **Step 4:** PASS. **Step 5: Commit** `feat(db): product catalog and server-side entitlement resolver`.

### Task 9: Ledger kuota atomik WIB

**Files:** Create `supabase/migrations/20261016000003_quota.sql`, `tests/db/quota.test.ts`.

**Interfaces:** Consumes `resolve_entitlement` (Task 8). Produces `public.wib_day(ts timestamptz) returns date`; tabel `ai_usage_reservations(id, group_id uuid, user_id, local_date date, quota_type text check in ('MESSAGE','DOCUMENT','REVIEW'), idempotency_key text, status text check in ('RESERVED','FINALIZED','RELEASED'), expires_at, created_at, unique(user_id, local_date, quota_type, idempotency_key))`; fungsi `reserve_usage(p_user uuid, p_kind text /* MESSAGE|DOCUMENT|AI_REVIEW */, p_key text, p_now timestamptz) returns table(status text /* RESERVED|DUPLICATE|QUOTA_MESSAGE|QUOTA_DOCUMENT|QUOTA_AI_REVIEW */, group_id uuid, reset_at timestamptz)`, `finalize_usage(p_group uuid) returns void`, `release_usage(p_group uuid) returns void`. `AI_REVIEW` memesan satu baris `REVIEW` dan satu `MESSAGE` dalam satu grup, atomik. Terpakai = `FINALIZED` + `RESERVED` yang belum lewat `expires_at` (TTL 300 detik, ditandai default rekayasa). Kunci per user-hari: `pg_advisory_xact_lock`.

- [ ] **Step 1: Failing tests** (helper `at("2026-10-16T10:00:00Z")` dst.): (a) Free: pesan ke-20 `RESERVED`+finalize, ke-21 `QUOTA_MESSAGE`; dokumen ke-1 ok, ke-2 `QUOTA_DOCUMENT`; (b) Member aktif: 60 ok/61 ditolak; 5 ok/6 ditolak; (c) batas hari: reservasi pada `2026-10-16T16:59:59Z` dihitung tanggal 2026-10-16 dan `17:00:00Z` tanggal 2026-10-17 (kuota hari baru kosong); `reset_at` = `2026-10-16T17:00:00Z`; (d) konkurensi: dua `reserve_usage` paralel (dua koneksi) saat terpakai 19 → tepat satu `RESERVED`; (e) `release_usage` mengembalikan kuota; reservasi lewat TTL tidak dihitung; kunci idempoten sama → `DUPLICATE` dengan `group_id` sama dan tidak menambah hitungan; (f) AI review Free: ke-2 ok, ke-3 `QUOTA_AI_REVIEW`; tiap review sukses menambah 1 ke pesan; saat pesan habis tetapi review tersisa → `QUOTA_MESSAGE` dan **tidak ada** baris `REVIEW` tertahan; gagal (`release`) mengembalikan keduanya; (g) upgrade siang hari: terpakai tetap, batas naik setelah membership `ACTIVE`; kedaluwarsa siang hari dengan terpakai 30 > 20 → sisa 0 dan reservasi baru ditolak; (h) `authenticated` tidak dapat `EXECUTE reserve_usage`/`finalize_usage`/`release_usage` dan tidak dapat menulis `ai_usage_reservations`.
- [ ] **Step 2:** FAIL. **Step 3:** Implementasi SQL; `wib_day` = `(ts at time zone 'Asia/Jakarta')::date`; `reset_at` = awal hari berikutnya di WIB sebagai `timestamptz`; hak `EXECUTE` hanya `service_role`.
- [ ] **Step 4:** `npm run test:db` → PASS. **Step 5: Commit** `feat(db): atomic WIB quota ledger with AI-review dual reservation`.

### Task 10: Pembungkus kuota TS + `GET /api/usage`

**Files:** Create `src/lib/ai/quota.ts`, `src/app/api/usage/route.ts`, `tests/db/quota-store.test.ts`.

**Interfaces:** Consumes fungsi SQL Task 8–9. Produces:
`type UsageKind = "MESSAGE"|"DOCUMENT"|"AI_REVIEW"`;
`type QuotaCode = "AI_MESSAGE_QUOTA_REACHED"|"DOCUMENT_DAILY_QUOTA_REACHED"|"AI_REVIEW_QUOTA_REACHED"` (kode ketiga adalah pilihan rekayasa; v8 hanya menamai dua);
`type ReserveResult = { ok: true; groupId: string; duplicate: boolean } | { ok: false; code: QuotaCode; resetAt: string }`;
`type UsageSnapshot = { plan: PlanKey; messageLimit: number; messagesUsed: number; messagesRemaining: number; documentLimit: number; documentsUsed: number; documentsRemaining: number; aiReviewLimit: number; aiReviewsUsed: number; aiReviewsRemaining: number; resetAt: string }`;
`interface UsageStore { reserve(userId: string, kind: UsageKind, key: string, now?: Date): Promise<ReserveResult>; finalize(groupId: string): Promise<void>; release(groupId: string): Promise<void>; snapshot(userId: string, now?: Date): Promise<UsageSnapshot> }`;
`createPgUsageStore(pool: Pool): UsageStore`.

- [ ] **Step 1: Failing tests:** `snapshot` Free baru → `messagesRemaining: 20`, `documentsRemaining: 1`, `aiReviewsRemaining: 2`, `resetAt` = awal hari WIB berikutnya (ISO UTC); setelah 1 reserve+finalize pesan → `messagesUsed: 1`; `reserve` melewati batas → `{ ok: false, code: "AI_MESSAGE_QUOTA_REACHED", resetAt }`; kunci sama dua kali → `duplicate: true`.
- [ ] **Step 2:** FAIL. **Step 3:** Implementasi dengan satu `Pool` bersama; route `GET /api/usage` mengembalikan `UsageSnapshot` hanya untuk sesi terautentikasi (anonim → 401 `AUTH_REQUIRED`); `userId` hanya dari sesi.
- [ ] **Step 4:** PASS. **Step 5: Commit** `feat(ai): usage store and GET /api/usage`.

### Task 11: Klien gateway (server-only, `model: "auto"`, mock)

**Files:** Create `src/lib/ai/gateway.ts`, `src/lib/flags.ts`, `tests/unit/gateway.test.ts`.

**Interfaces:** Produces `type ChatMessage = { role: "system"|"user"|"assistant"; content: string }`; `class GatewayError extends Error { code: "TIMEOUT"|"RATE_LIMITED"|"UPSTREAM_5XX"|"BAD_RESPONSE"|"UNAVAILABLE" }`; `chat(messages: ChatMessage[], opts?: { fetchImpl?: typeof fetch; timeoutMs?: number; env?: { FREELLM_BASE_URL?: string; FREELLM_API_KEY?: string; AI_MOCK_MODE?: string } }): Promise<{ text: string; requestId: string }>`; `flags: { aiPreReview: boolean }` (dari `AI_PREREVIEW_ENABLED`, default `false`).

- [ ] **Step 1: Failing tests:** setiap request ke fetch palsu membawa body JSON dengan `model === "auto"` (diulang untuk 3 panggilan, termasuk retry); `gateway.ts` mengimpor `server-only`; mock mode (`AI_MOCK_MODE=true`) tidak memanggil fetch dan mengembalikan teks deterministik berawalan `[MOCK]`; 429 → `RATE_LIMITED`; 500 → `UPSTREAM_5XX`; fetch menggantung → `TIMEOUT` pada `timeoutMs` kecil; balasan HTML, `{}` , `choices: []`, atau teks > 200_000 karakter → `BAD_RESPONSE`; retry maksimal 1 untuk 5xx/timeout, tidak untuk 429; tidak ada env `FREELLM_MODEL` yang dibaca (`grep -n "FREELLM_MODEL" src` kosong, dicek dalam tes lewat pembacaan file).
- [ ] **Step 2:** FAIL. **Step 3:** Implementasi `fetch` ke `${FREELLM_BASE_URL}/chat/completions` dengan header `Authorization: Bearer`; jika `NODE_ENV === "production"` dan `AI_MOCK_MODE === "true"`, lempar `GatewayError("UNAVAILABLE")`.
- [ ] **Step 4:** PASS. **Step 5: Commit** `feat(ai): server-only gateway client with literal auto model and mock mode`.

### Task 12: `handleChat` dan `POST /api/ai/chat`

**Files:** Create `src/lib/ai/handle-chat.ts`, `src/app/api/ai/chat/route.ts`, `src/lib/analytics/events.ts`, `tests/db/handle-chat.test.ts`.

**Interfaces:** Consumes `UsageStore`, `chat`, `GatewayError`. Produces `type ChatDeps = { getUserId: () => Promise<string | null>; store: UsageStore; chat: typeof chat; recordMetric: (m: { requestId: string; userId: string; status: "SUCCESS"|"FAILED"; latencyMs: number; errorCode?: string }) => Promise<void> }`; `handleChat(deps: ChatDeps, req: Request): Promise<Response>`; `recordEvent(pool: Pool, e: { name: string; actorUserId?: string; entityType?: string; entityId?: string; dedupeKey: string; metadata?: Record<string, string|number|boolean> }): Promise<void>`.

Respons: 401 `{ code: "AUTH_REQUIRED" }`; 400 `{ code: "INVALID_REQUEST" }`; 429 `{ code: QuotaCode, resetAt }` dengan header `Retry-After`; 502 `{ code: "AI_UNAVAILABLE", preserved: true }`; 200 `{ text, requestId }`. Header `Idempotency-Key` wajib; kunci sama → hasil sama tanpa biaya kedua.

- [ ] **Step 1: Failing tests:** anonim → 401 dan `chat` **tidak dipanggil**; kuota habis → 429 dan `chat` tidak dipanggil; gateway melempar `TIMEOUT` → 502, `release` dipanggil, `snapshot.messagesUsed` tetap 0; sukses → `finalize`, `messagesUsed` 1; `Idempotency-Key` sama dua kali → satu panggilan `chat`, `messagesUsed` 1; header `x-plan: MEMBER` dan body `{ plan: "MEMBER", user_id: "<lain>" }` diabaikan → kuota tetap 20; `recordMetric` dan event tidak berisi isi pesan (aserta: `JSON.stringify(metadata)` tidak memuat teks prompt uji).
- [ ] **Step 2:** FAIL. **Step 3:** Implementasi urutan: autentikasi → validasi Zod `{ messages: ChatMessage[] (1–40) }` → `reserve(MESSAGE)` → `chat` → `finalize`/`release` (`finally` menjamin pelepasan saat error) → metrik. Satu panggilan upstream aktif per user (lock in-memory per proses); batas konkurensi global ditunda sampai ada beban nyata.
- [ ] **Step 4:** PASS. **Step 5: Commit** `feat(ai): authenticated chat endpoint with atomic quota and safe metrics`.

### Task 13: Wawancara terstruktur (Zod + perbaikan terbatas)

**Files:** Create `src/lib/ai/interview.ts`, `tests/unit/interview.test.ts`.

**Interfaces:** Produces `parseInterviewJson<T>(schema: z.ZodType<T>, raw: string, repair: (raw: string, error: string) => Promise<string>, maxRepairs?: number /* default 2 */): Promise<{ ok: true; data: T } | { ok: false; fallback: "manual_form" }>`.

- [ ] **Step 1: Failing tests:** JSON valid → `ok: true` tanpa memanggil `repair`; JSON rusak lalu valid pada percobaan ke-2 → `ok: true`, `repair` dipanggil 1×; selalu rusak → `{ ok: false, fallback: "manual_form" }` dengan `repair` dipanggil tepat 2×; JSON valid tetapi skema salah (mis. jumlah negatif) → diperlakukan sebagai kegagalan validasi dan diperbaiki, bukan diterima; blok ```json fences dipangkas sebelum parse.
- [ ] **Step 2:** FAIL. **Step 3:** Implementasi. **Step 4:** PASS. **Step 5: Commit** `feat(ai): bounded JSON repair with manual-form fallback`.

### Task 14: Catatan analisis AI awal + flag produksi OFF

**Files:** Create `supabase/migrations/20261016000004_ai_review.sql`, `tests/db/ai-review.test.ts`.

**Interfaces:** Produces tabel `ai_review_reports(id, user_id, logical_request_id uuid unique, version_ref text, sha256 text, report_json jsonb, analyzer_policy_version text, completed_at)` (RLS: user hanya membaca miliknya; tidak ada INSERT/UPDATE dari klien); fungsi `save_ai_review(p_user uuid, p_group uuid, p_logical uuid, p_version_ref text, p_sha256 text, p_report jsonb, p_policy text) returns uuid` yang **hanya** menyimpan bila grup `AI_REVIEW` berstatus `RESERVED` lalu memfinalisasi grup dalam transaksi yang sama.

- [ ] **Step 1: Failing tests:** simpan sukses → 1 baris laporan dan grup `FINALIZED` (REVIEW dan MESSAGE); panggilan ulang dengan `logical_request_id` sama → tidak menambah baris; grup `RELEASED` → fungsi menolak dan tidak ada baris; tidak ada baris `document_verifications` yang dibuat (badge AI belum ada; bukan pengesahan hukum); `flags.aiPreReview` `false` secara default (unit).
- [ ] **Step 2:** FAIL. **Step 3:** Implementasi. **Step 4:** PASS. **Step 5: Commit** `feat(db): persisted AI preliminary report tied to quota finalization`.

### Task 15: Verifikasi akhir dan laporan

**Files:** Modify `README.md` (cara lokal: `npm ci`, `npm run check`, env sintetis).

- [ ] **Step 1:** Jalankan `npm run check` dan `npm run build`. Expected: semua PASS; catat jumlah tes yang benar-benar dijalankan.
- [ ] **Step 2:** Periksa cakupan peninjauan: `grep -rn "model:" src/lib/ai/gateway.ts` hanya literal `"auto"`; `grep -rn "SUPABASE_SERVICE_ROLE_KEY\|FREELLM_API_KEY" src` tidak muncul di berkas bertanda klien; `python3 -I scripts/validate_package.py` tetap PASS.
- [ ] **Step 3:** Tulis laporan singkat (berkas dibuat, cara lokal, hasil pemeriksaan terarah, blocker konkret untuk Fase 2). Jangan klaim E2E atau smoke lulus; tidak ada yang dijalankan.
- [ ] **Step 4: Commit** `docs: Phase 0-1 local setup and verification report` lalu `git push -u origin claude/great-cerf-8hwfjk`.

---

## Self-review (dijalankan)

- **Cakupan spec:** katalog/hak (T8), kuota dan reservasi atomik (T9–T10), gateway `auto` + mock (T11), login sebelum AI (T5–T6, T12), tiga shell + pricing (T7), atribusi sumber iklan (T3, T6, T12 event), flag OFF (T11, T14), CI manual dan `check` (T1). Dicakup fase berikutnya, bukan di sini: adapter pembayaran, tahunan/bundle, Vault aktif, template, review, Deep/Enhanced, QR.
- **Konsistensi tipe:** `PlanKey`, `QuotaCode`, `UsageStore`, `ReserveResult`, `GatewayError`, nama fungsi SQL dan status konsisten antar-task.
- **Deviasi disengaja:** kode `AI_REVIEW_QUOTA_REACHED` (pilihan rekayasa); TTL reservasi 300 detik dan maksimal 2 perbaikan JSON (default rekayasa); `reviewer` tidak mengakses `/dashboard` (mengikuti `PERMISSIONS.md`).
- **UNKNOWN yang menghambat fase ini:** tidak ada. Endpoint gateway sungguhan, merchant, dan sign-off partner tidak diperlukan karena memakai mock dan data sintetis.

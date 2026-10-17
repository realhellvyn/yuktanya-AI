# Cara menjalankan handoff v8 di Claude Code

## Mulai
1. Ekstrak ZIP; buka folder `yuktanya-claude-code` sebagai proyek.
2. Baca README.md dan CLAUDE.md. Salin prompts/CLAUDE_CODE_START.md ke Claude Code.
3. Paket ini berisi spesifikasi. Belum ada Next.js app, dependency manifest, SQL migration
   executable, test runner aplikasi, atau sertifikasi hukum. Jangan mengaku aplikasi siap.
4. Buat fondasi Phase 0/1 dahulu dengan mock AI dan pembayaran. Simpan rahasia di env lokal;
   gunakan .env.example. Verifikasi endpoint FreeLLMAPI di lingkungan implementasi.

## Urutan vertical slice
0. Next.js strict TypeScript, Supabase Auth, role/permission/RLS, private storage, public
   landing/pricing, tiga dashboard shell. Register wajib sebelum AI, IDOR tests terarah.
1. Entitlement resolver, atomic 20/1/2 dan 60/5/10 quotas, WIB buckets, server gateway `auto`,
   synthetic mock AI. AI preliminary record setelah persisted success, bukan legal badge.
2. Tiga template draft menunggu partner approval, structured interview, deterministic
   rendering, immutable versions+SHA-256, export artifacts and private Vault.
3. Standard checkout, settled payments, discount reservation ledger, assignment/conflict,
   Legal Note editor, final signed-off report, Legal Verified with/without notes, safe QR.
4. Deep eligibility + additional quote/payment, checklist/evidence, explicit professional
   approval/denial, Enhanced guard, revocation dependency, exceptional payment resolution.
5. Admin revenue/operations funnel, reconciliations, alerts, audit exports, accessibility
   and selected release smoke; satisfy partner/privacy/security/hosting gates before pilot.

Instrument metrics from early phases; actual money/member activation only after verified
billing exists. Test fixtures never enable production entitlement. Special cases remain
separate quote/engagement; do not squeeze high-risk cases through paid standard/deep.

## Suggested implementation modules
`src/lib/reviews/{eligibility,notes,standard,deep,approval}.ts`,
`src/lib/verification/{issue,revoke,public-projection,qr}.ts`,
`src/lib/billing/{quotes,settlement,discounts}.ts`, `src/lib/auth/permissions.ts`,
`src/lib/audit/`, `src/lib/analytics/`. These paths are proposed, not existing app files.

## Done per slice
Working UI and server transaction, authorization/RLS, recoverable failure state, safe audit
event, focused checks suited to impact, short report of files/setup/results/open blockers.
Do not ask for a new approval on every routine implementation choice. Do not resolve
unknown legal/commercial policy by invention; prototype with explicit disabled production flag.

## Migration guidance
Inspect real existing schema if integrating into app; no destructive reset. Add nullable
new columns/tables, backfill kind STANDARD for old known human reviews, preserve AI kind,
normalize verification table names, then validate constraints. No retroactive Enhanced,
no automatic conversion of old free text to actionable published notes without professional
confirmation. Generate historical QR safely without changing original hashes/issue dates.
Use feature flags OFF for deep payment and Enhanced until policies/partner rubric signed
(superseded 17 Oct 2026 by owner decision: flags ON in production; rubric gate stays in DB).
Deploy schema-compatible server before enabling UI; rollback disables new intake, preserves
paid work and evidence for audited operations resolution. Migration tests on staging.

## Tests
Follow TEST_STRATEGY.md. No E2E for every new screen/change. Implement scenario catalogue
as features land and execute selected tags when related critical flows change or release.
Package validation is separate: `python scripts/validate_package.py` verifies manifest/hash
integrity only. It does not test application behavior or legal correctness.

# Yuktanya v8 Completion B–G Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Finish everything in the v8 blueprint that is still missing or unproven (sub-projects B–G of the completion spec) so the full product runs end to end and is proven by automated browser tests, with zero manual form-based document creation.

**Architecture:** Existing modular monolith (Next.js 16 App Router, pg services + SECURITY DEFINER SQL functions, Supabase). Each task = TDD (failing unit/DB test first), minimal implementation, E2E scenario in `tests/e2e/`, `npm run check` green. UI uses existing `src/components/ui/*` tokens (navy, brand, line, canvas), large touch targets (≥44px), plain Bahasa Indonesia.

**Tech Stack:** Next.js 16, TypeScript, Tailwind v4, vitest, Playwright (via `bash scripts/e2e/run.sh`), Postgres via `bash scripts/db/with-test-db.sh`.

**Spec:** `docs/superpowers/specs/2026-10-16-yuktanya-v8-completion-design.md` (rulings R1–R9 binding) and `CLAUDE.md`.

## Global Constraints

- Indonesia-only; plain Bahasa Indonesia for older/low-digital-literacy users; never the word "cap" in UI.
- Login before any AI. Every LLM call server-only via FreeLLMAPI with literal `model: "auto"`; no model selector.
- Quotas: Free 20 messages / 1 new document / 2 AI reviews; Member 60 / 5 / 10; each successful AI review also uses 1 message; reset 00.00 Asia/Jakarta; atomic reservation, idempotency, failure release.
- Prices: Membership Rp19.000; Standard review Free Rp50.000, active Member first per period Rp30.000, later Rp35.000; Deep additional Free Rp200.000 / Member Rp150.000.
- Flags `AI_PREREVIEW_ENABLED`, `DEEP_REVIEW_PURCHASE`, `ENHANCED_ISSUANCE` default OFF in production; E2E env sets them ON.
- Payment never guarantees Enhanced/legal result. Admin cannot impersonate reviewer authority. AI/uploads/payment callbacks cannot grant professional approval.
- Mandatory copy (exact): AI draft: "Dibuat dengan bantuan AI. Belum diperiksa oleh profesional hukum." AI pre-review: "Analisis awal AI bersifat informasional dan dapat keliru." Verified: "Dokumen versi ini telah diperiksa oleh profesional hukum sesuai ruang lingkup review yang tercantum. Tidak menjamin keabsahan atau hasil hukum tertentu." Special case: "Biaya dan ruang lingkup ditentukan setelah asesmen profesional."
- Synthetic data only; no real confidential data to AI. Legal text (privacy/terms/refund) must NOT be invented: mark legal sections "Menunggu persetujuan mitra hukum" and describe only actual system behavior.
- Every DB change = new migration file in `supabase/migrations/` (next number after `20261016000029`), plus a DROP/DELETE-free note if staging variant differs (see `docs/RELEASE_CHECKLIST.md`).
- Commit messages end with: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_016B7SX6nyHrmjD4FoWDsi9m`. Never write a model identifier into repo files. Git remote must be `https://github.com/realhellvyn/yuktanya-AI.git`; branch `claude/great-cerf-8hwfjk`; push with `git push -u origin claude/great-cerf-8hwfjk`.
- Test commands: unit+DB `npm run check`; browser `bash scripts/e2e/run.sh` (env `VIEWPORTS`, `JOURNEY=./journey-roles.mjs,...`, `SHOTS_DIR`). Never claim a test passed that was not run.
- UI test rules already enforced in E2E: no horizontal overflow, touch targets ≥43.5px on listed pages, no console errors.

## No-Repeat Rule (owner instruction)

Work that is already finished and passing is NOT redone: sub-project A (AI chat), the standard-review cross-role E2E steps, the 360 DB tests and 231 unit tests. Subagents run only focused tests for what they change while iterating, and the full `npm run check` once before their commit. Full `bash scripts/e2e/run.sh` is run by an implementer only when its task touches browser-visible behavior, and the complete multi-journey run happens once in Task 9. Reviewers do not re-run suites the implementer already ran.

## Review Focus

- Role pages opened by the wrong role (user→/admin, reviewer→/admin, coordinator of another firm) must redirect/deny; test it.
- Every new server action must re-check ownership/role on the server, not only in UI.
- Forms that succeed must show an explicit success message; failures must show a plain-language reason and keep typed data.
- Public pages (`/verify`, `/privacy`, `/terms`, `/design-preview`) must work without login and without cache staleness for revocation.
- Mobile (375px) layouts of every new page: no overflow, buttons ≥44px.

---

### Task 1: Finish the cross-role E2E (Enhanced issuance + parent revocation)

**Files:** Modify `tests/e2e/journey-roles.mjs`, `tests/e2e/helpers.mjs`; fix whatever application bug it exposes under `src/`.

**Context:** `bash scripts/e2e/run.sh` currently ends 35/38: in the deep-review step, after the reviewer completes extra work, dispositions and M1–M7 PASS and chooses "Setujui Enhanced" (select `decision`=APPROVE, checkbox `attest`), no `LEGAL_ENHANCED` verification is created (page shows "Tersimpan." only). Two later steps fail as a consequence. Standard flow (register 4 actors → admin firm/members/authorization → owner NDA via chat → pay by bank transfer → admin confirms → coordinator assigns → reviewer publishes WITH_NOTES → public `/verify/<code>` Aktif) already passes.

- [ ] Do NOT rewrite the passing steps of `journey-roles.mjs`; start from the failing deep step. Diagnose root cause (check the decision action result code, `decide_deep` guards in `supabase/migrations/20261016000024_deep_decision.sql`, rubric approval row, `ENHANCED_ISSUANCE` flag passed to the dev server env in `tests/e2e/run.mjs`, checklist/disposition form submissions, stale `revision` hidden fields). Fix the real cause in app code or test harness. Do not weaken guards; payment must never bypass checklist/rubric/attestation.
- [ ] Extend the journey so it also proves: (a) a regular user and a reviewer-only account get denied on `/admin` and `/admin/payments`; (b) a coordinator cannot see requests of another firm (use DB helper to create a second firm if needed, or assert via DB-level negative test in `tests/db`); (c) after admin revokes the parent LEGAL verification the public page of the Enhanced code shows "Ditangguhkan sementara" or "Dicabut"; (d) a new document version created from the same document shows "baru/belum diperiksa" with no badge (E12).
- [ ] Run `bash scripts/e2e/run.sh` fully (desktop + mobile for journey.mjs; desktop for roles) → all green. Run `npm run check` → green. Commit.
- Expected: `NN/NN lulus`, 0 FAIL.

### Task 2: Public & account pages (C part 1)

**Files:** Create `src/app/(public)/privacy/page.tsx`, `src/app/(public)/terms/page.tsx`, `src/app/(public)/bantuan/page.tsx`, `src/app/(public)/design-preview/page.tsx`, `src/app/(auth)/forgot-password/page.tsx` (+ `reset-password`), resend-confirmation action on login/register error path, `src/app/(app)/settings/page.tsx` (+ actions), tests in `tests/unit/` and `tests/e2e/journey-public.mjs`. Modify `src/components/site-header.tsx` / footer links.

- [ ] `/privacy`, `/terms`: factual description of what the system does (what data is stored, AI gateway use after consent, retention items that exist in the code), each legal section carrying visible text "Menunggu persetujuan mitra hukum"; linked from footer and registration form. No invented legal claims.
- [ ] `/bantuan`: plain-language help (how to make a document, quotas, how to ask lawyer review, how to verify a document) from existing product rules; contact line stating contact channel is not yet configured (no fake email).
- [ ] `/design-preview`: renders Button, Card, StatusBadge, StepIndicator, form fields in all states (public, noindex).
- [ ] Forgot password + reset (Supabase `resetPasswordForEmail` / `updateUser`), resend confirmation (`auth.resend`); E2E fake Supabase must implement the endpoints it needs; unit-test the actions' error mapping to plain Indonesian.
- [ ] `/settings`: shows account email, plan, quotas; buttons "Unduh data saya" (JSON of profile, documents metadata, messages — added in Task 8) as disabled link until Task 8 lands is NOT allowed: implement the page with the sections Akun, Privasi (link), Hapus akun (explains consequences; action implemented in Task 8). For this task render only Akun + Privasi sections and leave a documented seam.
- [ ] E2E `journey-public.mjs` (add to default JOURNEY list in `tests/e2e/run.mjs`): all new public routes return 200 w/o login, contain required markers, have no overflow at 375px; forgot-password form shows confirmation; `/settings` requires login.
- [ ] `npm run check` + the new E2E green. Commit.

### Task 3: Partner & admin UI completion (C part 2)

**Files:** Modify/create under `src/app/(partner)/partner/` (`team/page.tsx`, `approvals/page.tsx`, polish `page.tsx`, `reviews/[id]/page.tsx`, `deep/[id]/page.tsx`) and `src/app/(admin)/admin/*` pages and layouts; reuse `src/components/ui/*`; add `src/components/partner/*` as needed.

- [ ] `/partner/team` (coordinator only): list firm reviewers with email, active assignments, authorization validity; link to assign; no platform role grants. Non-coordinator → 404/redirect. DB/service test for the query; E2E asserts coordinator sees it and a reviewer-only account does not.
- [ ] `/partner/approvals`: list of the signed-in reviewer's final-decision-ready items (standard reviews with scope+notes ready to publish, deep reviews with complete checklist), each linking to the editor; states explanation why item is not ready ("Isi ruang lingkup" etc.). No pay-to-approve control.
- [ ] Restyle partner and admin pages with the same layout/typography/tokens as user pages (navy headings, Card, Button), page `<title>` always including review type, responsive (mobile tabs `Dokumen | Catatan | Pemeriksaan | Hasil` on reviewer editor per `docs/PARTNER_DASHBOARD.md`), final publish confirmation names exact version, outcome, unresolved notes and scope; disabled publish explains the missing requirement in text.
- [ ] Admin layout: nav to all admin sections, role guard; mobile layout without overflow.
- [ ] Extend `journey-roles.mjs` (or new `journey-ui-roles.mjs`) with checks: touch targets ≥43.5px, no overflow at 375px (run a second mobile pass of key partner/admin pages with a dedicated lightweight journey using seeded DB data), no console errors.
- [ ] `npm run check`, E2E green. Commit.

### Task 4: Owner-side Deep Review routes (C part 3)

**Files:** Create `src/app/(app)/reviews/[id]/deep/page.tsx` (offer detail + confirm), `src/app/(app)/deep-reviews/[id]/page.tsx` (status + result), keep existing components `src/components/deep/*`.

- [ ] `/reviews/[id]/deep`: shows offer (price by plan, "Pembayaran tidak menjamin Enhanced…" statement before accept), eligibility reasons when not offered, explicit accept button → checkout; flag-gated by `DEEP_REVIEW_PURCHASE`; 404 when flag off or not owner.
- [ ] `/deep-reviews/[id]`: owner view of deep status timeline (dipesan → dibayar → ditugaskan → diperiksa → selesai), result with limitations, Enhanced or not with plain-language reason; owner of another account → 404.
- [ ] Link both from `/reviews/[id]`. DB/handler tests for ownership; E2E steps added to `journey-roles.mjs`.
- [ ] green, commit.

### Task 5: Special Legal Case (E)

**Files:** Migration `20261016000030_special_cases.sql` (+ staging note), `src/lib/cases/*`, `src/app/(app)/cases/new|[id]`, `src/app/(partner)/partner/cases/*`, `src/app/(admin)` view if needed, tests `tests/db/special-cases.test.ts`, E2E `journey-cases.mjs`.

- [ ] Data model: `special_cases(id, owner_id, document_id?, summary, status [SUBMITTED|TRIAGED|QUOTED|ACCEPTED|DECLINED|CLOSED], quote_amount_idr?, quote_scope?, quote_expires_at?, consent_at, created_at ...)`, events `special_case_requested`, `special_case_quote_sent`, `special_case_quote_accepted` written server-side. RLS default-deny, SECURITY DEFINER functions with role checks (only coordinator/admin triage+quote; owner submits/accepts/declines). Acceptance never creates payment auto-capture or professional approval.
- [ ] Owner flow: from document page or `/cases/new` ("Dokumen ini memerlukan penilaian khusus"), consent checkbox, text "Biaya dan ruang lingkup ditentukan setelah asesmen profesional." exact; cannot buy standard review for a document flagged special.
- [ ] Partner `/partner/cases`: coordinator triage, send custom quote (amount, scope, expiry); owner sees quote, accepts/declines explicitly.
- [ ] TDD DB tests incl. authorization denials; E2E journey: owner submits → coordinator quotes → owner accepts → statuses visible; second user cannot see it.
- [ ] green, commit.

### Task 6: Upload + AI pre-review UI (D, flag-gated)

**Files:** `src/app/(app)/documents/upload/page.tsx` (+ action), `src/lib/uploads/*` (validate by content+extension+size, parse PDF/DOCX/TXT in isolated function with limits; prefer existing deps, no new paid service), UI components under `src/components/ai-review/*`, tests `tests/unit/uploads.test.ts`, `tests/db/*`, E2E `journey-ai-review.mjs`.

- [ ] Uploads: accept PDF/DOCX/TXT ≤ configured size; reject by magic bytes mismatch; store private (existing blob/Storage layer); extracted text never logged. Gate whole feature on `AI_PREREVIEW_ENABLED`; when OFF the route explains it is not yet available and nothing is sent to AI.
- [ ] Explicit consent checkbox naming the AI gateway before analysis (`SECURITY_AND_LEGAL.md`); AI review uses 1 AI-review quota unit + 1 message unit, released on failure; output grouped per `docs/WIREFRAMES.md` §8 with exact label "Analisis awal AI bersifat informasional dan dapat keliru."; AI Verified badge is distinct from Legal Verified and never granted for content AI itself generated.
- [ ] Unsupported/high-risk document → route to Special Case (Task 5) instead of fake output.
- [ ] Prompt-injection test: uploaded text containing instructions cannot change output schema/grant verification (unit test with fake LLM).
- [ ] E2E (flag ON in E2E env): upload a synthetic TXT/DOCX, consent, see grouped result and quota decrease; flag OFF behaviour verified in a unit test.
- [ ] green, commit.

### Task 7: Admin analytics completion (F)

**Files:** migration `20261016000031_*.sql` if needed, `src/lib/analytics/*`, `src/app/(admin)/admin/analytics|page.tsx`, tests `tests/db/admin-metrics.test.ts` extensions, E2E step.

- [ ] Event catalogue: server-side writer with dedupe key for all 19 v8 events listed in `docs/ANALYTICS*.md`/`docs/ADMIN_DASHBOARD.md` (find the list; if the docs list a different count, implement every event they name), hooked into the existing flows (signup, document created/frozen, AI message, AI review, review requested/paid/assigned/completed, deep events, verification issued/revoked, membership, case events). No PII/legal text in payloads (test asserts).
- [ ] Admin dashboard: daily trend charts (inline SVG, no new dependency), previous-period comparison, filters by document type and membership, custom date range (Asia/Jakarta day boundaries), quality panel, alerts for overdue review queue/AI errors; metrics computed from source tables; reconciliation test between events and source tables.
- [ ] Admin cannot read private document content (test).
- [ ] E2E: seeded data → admin sees charts, filter changes numbers, custom range works.
- [ ] green, commit.

### Task 8: Reliability & data rights (G)

**Files:** migrations (next numbers), `src/lib/retention/*`, `src/app/(app)/settings/*` actions, `src/components/documents/chat-panel.tsx` (autosave draft), runbook doc `docs/RUNBOOK.md`, tests.

- [ ] Retention: scheduled job (existing `/api/jobs/*` + `vercel.json`) purging `ai_attempts` older than 30 days and expired signed/ephemeral rows; unit/DB tests with fake clock.
- [ ] Data export: `Unduh data saya` returns JSON (profile, documents metadata, chat messages, orders; no other users' data, no admin notes) behind login; DB test proves isolation.
- [ ] Account deletion: confirmation flow in `/settings`; deletes/anonymizes owner data per documented rules, keeps payment/audit records required for reconciliation (document in `docs/RUNBOOK.md`), invalidates session; DB test.
- [ ] Chat input draft autosave in localStorage (try/catch), restored after failed send/redirect; offline banner "Anda sedang offline"; E2E covers draft restore.
- [ ] Apply `delete_note` as in `20261016000021_report_publish.sql` to staging cannot be automated (MCP blocks delete); document exact SQL for the owner in `docs/RELEASE_CHECKLIST.md` (already partly present: verify and complete).
- [ ] green, commit.

### Task 9: Release proof (CI, smoke, deploy)

**Files:** `.github/workflows/check.yml` (add job running e2e on `workflow_dispatch`), `tests/smoke/release-smoke.test.ts`, `tests/e2e/SCENARIOS.md`, `README.md`, `docs/RELEASE_CHECKLIST.md`.

- [ ] Update `tests/e2e/SCENARIOS.md` mapping scenarios E01–E14 to the automated journeys that cover them; list honestly any not automated.
- [ ] Extend the CI workflow (still `workflow_dispatch`, owner allowed running it) with an `e2e` job using Postgres service container + Playwright Chromium (`npx playwright install --with-deps chromium`); keep `check` job.
- [ ] Run locally: `npm run check`, `bash scripts/e2e/run.sh` (default journey list, both viewports), release smoke (`npx vitest run tests/smoke`). Trigger CI via the GitHub MCP `actions_run_trigger` and read job result; fix failures. Report only what actually ran.
- [ ] Update README status and RELEASE_CHECKLIST (what is built, what remains gate-blocked: legal approvals, privacy terms, real payment, real reviewers).
- [ ] Commit and push.

---

## Audit fix wave (Task 10 audits A–D: files in `.superpowers/sdd/2026-10-16-v8-completion-BG/audit-{A,B,C,D}.md`, local only)

Rulings (controller): B-04 (one admin can authorize a second account as reviewer) is a trust-model decision — not coded; recorded as a production blocker "dual control for professional authorization" in RELEASE_CHECKLIST. C17 (read-acknowledgement email cannot work without an email sender) — the feature must be honestly unavailable until an email provider is configured: UI says so, no promise of delivery; blocker recorded. Remaining Minor audit items not named below are recorded in the ledger and RELEASE_CHECKLIST "Celah", not coded.

### Task 11: Billing integrity fixes (audit A: A15, A21, A22, A23, A17, A28)

**Files:** new migration `supabase/migrations/20261016000035_billing_integrity.sql` (+ `supabase/staging/` variant ONLY if it contains DROP/delete), `src/lib/billing/*`, `src/app/(app)/membership`, `src/app/(app)/reviews/[id]/page.tsx`, `vercel.json` + a cron job route for `expire_orders`, tests in `tests/db`.

- [ ] Read audit-A.md for A15, A21, A22, A23, A17, A28 (exact evidence and repro).
- [ ] A15: ACTIVATE of a late payment on an expired Member-first order must not allow a second Rp30.000 first review in the same period (re-reserve the entitlement atomically or refuse/reprice and reconcile); TDD from the audit's repro.
- [ ] A21: a second payment on an already-PAID order (DISPUTED) must appear in the admin reconciliation/manual lists and the revenue "held" figure; TDD.
- [ ] A22: serialize membership fulfilment per user (advisory lock) so concurrent settlements cannot create overlapping periods; also make double-click "Lanjut ke pembayaran" reuse the pending order (idempotent per user+kind+ref window); TDD.
- [ ] A23: schedule `expire_orders` (daily cron via the existing jobs-route pattern, same auth) and make price preview sweep/consider expiry so a screen never quotes Rp35.000 where the charge will be Rp30.000.
- [ ] A17: pass the already-paid standard price to the deep offer and fix the misleading unit test.
- [ ] A28: `/membership` benefit list must only list implemented, non-proposed benefits (check migration 0014 "proposed" defaults vs actual behavior); wording change only.
- [ ] `npm run check` once; E2E once (all journeys). Commit, push.

### Task 12: Review integrity fixes (audit B: B-01, B-02, B-03 and D-18, plus Minor B items)

**Files:** new migration `20261016000036_review_integrity.sql`, `src/lib/reviews/*`, `src/lib/deep/*`, verification pages/components, `docs/DECISIONS_AND_PRECEDENCE.md`, tests.

- [ ] Read audit-B.md (B-01, B-02, B-03, and Minor list).
- [ ] B-01: record the author (reviewer user id) on checklist rows, note dispositions and Legal Notes drafts; on (re)assignment, work authored by a previous reviewer must not count for the new reviewer's sign-off: the new reviewer must re-confirm/re-enter (or approval requires every counted row authored by the deciding reviewer); TDD from the audit's repro (scratch file path is in audit-B.md).
- [ ] B-02: conflict-of-interest: add a conflict declaration/check at assignment AND at issuance for standard and deep (reviewer cannot be the owner; firm-level conflict flag; explicit "no conflict" attestation stored with the decision) and add the open-special-case check to Deep eligibility; TDD; keep UI copy plain.
- [ ] B-03/D-18: show the exact SECURITY_AND_LEGAL Verified label ("Dokumen versi ini telah diperiksa oleh profesional hukum sesuai ruang lingkup review yang tercantum. Tidak menjamin keabsahan atau hasil hukum tertentu.") on the Legal Verified result page, the public verification page for LEGAL/LEGAL_ENHANCED, and exports' verification block; add a DECISIONS entry; unit tests assert the exact string.
- [ ] Minor B items worth doing now (each with a test): enforce `ENHANCED_ISSUANCE` flag inside the DB decision function too (pass flag as parameter from the server) ; block UPDATE of a revoked verification back to active (trigger); partner form actions with malformed IDs show a plain notice instead of a raw server error; audit entries for checklist edits and eligibility rejections.
- [ ] Carried from Task 11 review (billing SQL, put in migration 36): (a) `expire_orders_scoped` must lock payments before orders (same order as `settle_payment`) or the cron job must retry on deadlock — pick one, test with a concurrent settlement; (b) DISPUTED payments on a CANCELLED order must appear in admin lists and allow REFUND_RECORDED (today they stay in "Ditahan" forever); (c) ACTIVATE must call `expire_orders_scoped(v_user, p_now)` after taking the advisory lock so an overdue unswept RESERVED entitlement doesn't yield a false DISCOUNT_TAKEN. TDD each.
- [ ] `npm run check` once; E2E once. Commit, push.

### Task 13: Security hardening (audit C: C12, C22, C21/C36, and Minor C items)

**Files:** `next.config.ts` (security headers), `src/proxy.ts`/`src/lib/auth/permissions.ts`, auth actions, `src/app/api/ai/chat/route.ts`, acknowledgement UI, tests.

- [ ] Read audit-C.md.
- [ ] C22: add security headers (Content-Security-Policy compatible with Next 16 App Router — nonce or `'unsafe-inline'` for styles as needed, `frame-ancestors 'none'`, X-Frame-Options DENY, Referrer-Policy strict-origin-when-cross-origin, X-Content-Type-Options nosniff, Permissions-Policy, HSTS) without breaking the E2E journeys (they run `next dev`: allow dev-only relaxations for `unsafe-eval` only when NODE_ENV!=='production'); unit test of the header config; E2E asserts headers on `/`.
- [ ] C12: app-level rate limit on login, signup, password-reset request, resend confirmation (per IP+email, DB- or memory-backed consistent with existing attempt limiters; prefer the existing DB `ai_attempts`-style limiter pattern); plain Indonesian message; tests. Note in RELEASE_CHECKLIST that CAPTCHA and Supabase-side limits need confirmation on the real project.
- [ ] C21/C36: `/api/ai/chat` is unused and a general LLM relay: remove the route and its handler/tests if nothing else imports them; if something does, restrict to the document-owner chat path only.
- [ ] C17: acknowledgement email: when no email provider is configured (detect via env), the share/ack UI states plainly that read-confirmation by email is not yet available and does not create challenges; test both states. Record blocker.
- [ ] Minor C: protect `/deep-reviews` and `/api/usage` in guards; unknown paths default-deny for authenticated areas where safe; `secure` flag on app cookies in production; `NEXT_PUBLIC_APP_URL`/QR base must fail closed (throw) in production if missing or not https; add `set search_path` to the three analytics functions lacking it (new migration `20261016000037_analytics_search_path.sql`, `create or replace` same bodies); partner server actions check role not just sign-in; admin allowed on `/api/partner` consistently or both denied (decide per PERMISSIONS.md).
- [ ] `npm run check` once; E2E once. Commit, push.

### Task 14: UX conformance fixes (audit D)

**Files:** many under `src/app/**`, `src/components/**`, copy in `src/lib/copy.ts`, tests/E2E.

- [ ] Read audit-D.md (all Important, then Minor where cheap).
- [ ] D-01 "Saya belum tahu": in `/workspace/new`, a fourth choice that starts a chat where the AI helps pick among the three supported templates (no fabricated document; if none fits, offer Special Case). The AI may only choose among catalogued templates; grounding rules apply; TDD with the fake LLM.
- [ ] D-03: Bantuan link in the logged-in navigation (sidebar + mobile) and a "Butuh bantuan?" line on the dashboard.
- [ ] D-04: version list shows real review status per version (reviewed/with badge/unreviewed), not a hard-coded label.
- [ ] D-05 (+ ledger item): remove raw `?error=` / `?notice=` echoes on `workspace/new`, `reviews/[id]/deep` and any other (grep for `searchParams` string rendering); map to fixed strings.
- [ ] D-06: checkout shows document title, version, scope of the review, who reviews, price rule ("AI gratis; pemeriksaan pengacara berbayar", membership price rule); use or remove the unused `PriceBreakdown`.
- [ ] D-07/D-14: review result shows reviewer role/firm name (no private data), completion date, report download if a report export exists (else state honestly), timeline dates; DECLINED review explains payment became a review credit (verify against the DB behavior; do not claim what the DB doesn't do).
- [ ] D-08: Bantuan wording must not claim `/verify` detects alterations; say it shows the document code to compare.
- [ ] D-09: add `not-found.tsx`, `error.tsx`, `global-error.tsx`, `loading.tsx` in plain Indonesian (no stack traces), E2E asserts a 404 route renders the Indonesian page.
- [ ] D-11: consumer screens explain "Catatan hukum" as "Catatan dari pemeriksa" with a plain one-line explanation where it first appears.
- [ ] Carried from Task 11 review: `src/components/billing/order-status.tsx` must render an order past `expiresAt` as expired/"batas waktu lewat" at render time (not "Menunggu pembayaran" with old transfer instructions) with a plain message to ask for a new order; `src/app/(admin)/admin/revenue/page.tsx` intro must say "Ditahan" includes money received but not verified; admin payments page maps INVALID, FORBIDDEN, NOT_FOUND and unique-violation races to plain Indonesian (no raw `CODE` echo).
- [ ] Cheap Minor D items: page `<title>`s on all pages, nav labels per UX_SPEC, plus these Task 9 review minors: README.md:106 smoke list (add E06,E12), `timeout-minutes` (30) on `check` and `smoke` CI jobs, SCENARIOS E08 wording (the browser step does not prove the queue is empty before confirmation; reword) and E12 gap cell (cite tests/db/publish.test.ts:94-99).
- [ ] `npm run check` once; full E2E once (both viewports). Commit, push.

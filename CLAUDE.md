# CLAUDE.md — Yuktanya v8

This is an implementation blueprint, not an implemented or legally approved application.
Read README.md, docs/DECISIONS_AND_PRECEDENCE.md, docs/VERIFICATION_POLICY.md,
docs/DEEP_REVIEW.md, docs/AI_FAIR_USAGE.md, docs/PERMISSIONS.md,
docs/TEST_STRATEGY.md and docs/IMPLEMENTATION_GUIDE.md, then remaining docs.

## Locked product rules
- Indonesia-only; plain Bahasa Indonesia, older/low-digital-literacy accessibility.
- Registration/login before ANY AI. Every LLM call is server-only through FreeLLMAPI with literal `model: "auto"`; no model selector.
- Free daily: 20 messages / 1 new document / 2 AI reviews. Active Member: 60 / 5 / 10. Every successful AI review also uses exactly one message. Reset 00.00 Asia/Jakarta. Atomic reservations, idempotency and failure release.
- Membership Rp19.000/billing period. Standard review: Free Rp50.000; active Member first per billing period Rp30.000, later Rp35.000. Preserve one reserved-or-consumed first-review entitlement per period.
- Three distinct dashboards: user `/dashboard`, legal partner/reviewer `/partner`, platform admin `/admin`. Partner coordinator is a permission set inside partner dashboard, not a fourth dashboard.
- Completed, authorized Standard Review can issue Yuktanya Legal Verified WITH_NOTES or WITHIN_SCOPE. Incomplete/inconclusive work issues no legal badge.
- Offer Deep Review ONLY after a completed Standard Review has published actionable Legal Notes. Additional fee: Free Rp200.000 / active Member Rp150.000. Never a direct purchase or replacement for Standard Review. Special Legal Case remains separate custom quotation.
- Enhanced ONLY after an authorized qualified legal professional completes extra review and confirms all required material criteria with evidence. Payment NEVER guarantees Enhanced, a favorable conclusion, legal validity or a court outcome.
- Immutable version + exact-byte SHA-256, scoped reports, audit, QR lookup and revocation; edits never inherit badges.
- Stack remains Next.js/TypeScript/Tailwind/shadcn, Supabase Auth/Postgres/private Storage/RLS, modular monolith. No new mandatory paid service.

## Testing instruction from owner
Do NOT run E2E after every artifact, screen or minor change. Choose checks by impact.
Copy/docs/style-only: focused inspection; logic: relevant unit/integration checks.
Run selected E2E for affected critical workflows and release smoke before pilot/release.
Do not repeatedly rerun a passing full suite without new changes/failures/risk.
Report what actually ran and what did not; do not claim planned tests passed.
See docs/TEST_STRATEGY.md and tests/e2e/SCENARIOS.md.

## Authority and implementation
Enforce roles, pricing, quotas, payment settlement, review eligibility and issuance on server/DB.
AI, uploaded documents and payment callbacks cannot grant professional approval.
No admin impersonation of reviewer authority. Do not send real confidential data to AI
until privacy/consent/upstream gates pass. Preserve launch gates in SECURITY_AND_LEGAL.md.
Template approval, legal criteria, professional authority, privacy, hosting and refund
policies remain production blockers where not approved; synthetic prototype may proceed.
Current human instructions override blueprint; canonical v8 decisions override historical docs.

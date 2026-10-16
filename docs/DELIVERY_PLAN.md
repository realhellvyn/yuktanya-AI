# Implementation Plan & Acceptance Tests

Build vertical slices. Do not deploy paid services before legal/security launch gates.

## Phase 0 — foundation
- Scaffold Next.js + TypeScript + Tailwind/shadcn.
- Supabase project wiring, migrations, Auth and RLS.
- Public homepage/pricing, login/register, guarded dashboard.
- `.env.example`, local setup instructions, tests.
**Accept:** anonymous users cannot call `/api/ai/*`; a signed-in user cannot read another user's data.

## Phase 1 — AI gateway
- Server-only OpenAI-compatible client to `FREELLM_BASE_URL`, always `model: "auto"`.
- Auth, **Free/Member entitlement resolver**, transactional quota reservations, rate limit, timeout, error handling, basic metrics, mock gateway mode for local tests. For Phase 1, use test fixtures for active membership; real activation requires verified payment in Phase 4.
- Structured interview with Zod validation.
**Accept:** tests assert every call uses `"auto"`; no secrets exposed; unavailable gateway preserves user data.

## Phase 2 — three templates + documents
- Template approval/version model.
- PKS, Utang Piutang, NDA **draft templates subject to partner signoff**.
- Structured fields, deterministic rendering, preview, save versions, DOCX/PDF export.
- Private Storage and cross-user RLS.
**Accept:** no fabricated facts; invalid fields blocked; edited reviewed versions do not inherit verification.

## Phase 3 — review workflow
- Upload parsing and privacy consent. **Keep production AI pre-review disabled until its upstream privacy/security review is approved**; mock/synthetic tests are allowed.
- Submission, triage, standard vs special routing.
- Partner reviewer dashboard, assignments, revision loop, report.
- Verification record and minimal public verification.
**Accept:** only assigned reviewer can read/review; only authorized human-completed review can issue Legal Verified; successful AI preliminary analysis can issue AI Verified; hash/version match.

## Phase 4 — monetization
- Real membership purchase/activation and server-side pricing (replacing Phase 1 fixture-based entitlement).
- Manual transfer/admin-confirmation as temporary MVP, with auditable payment states.
- Discount entitlement ledger and atomic reservation.
- Special-case intake and custom quote.
**Accept:** first member review each active billing period Rp30k, later Rp35k, nonmember Rp50k; concurrent orders cannot double-spend discount; special cases cannot purchase standard review automatically.

## Phase 5 — controlled pilot
- Synthetic legal benchmark and law firm quality assessment.
- Security/RLS testing, privacy and consent review, hosting/commercial terms check.
- Test pilot with limited users and operational capacity.
- Measure latency, failure rate, lawyer correction rate, conversion and cost.

## Test matrix
- Auth: anonymous denied, email verification rules, session expiry.
- Access: cross-tenant document read/write blocked; reviewer sees only assigned work.
- AI: model `auto`, invalid JSON, gateway 429/5xx/timeouts, prompt injection.
- Document: field validation, no fabricated names, version immutability, hash integrity.
- Pricing: membership active/expired, first/subsequent review, concurrency, failed payments.
- Review: assignment/reassignment, reviewer permissions, revision required, Legal Verified only after authorized human completion; AI Verified after successful persisted AI analysis.
- Special: high-risk triage, custom quote, declined cases, conflict check.
- Privacy: signed URL expiry, file retention, no public contents.
- Mobile: chat/document tab, upload, checkout and review status.

## Not in first MVP
Automatic e-sign/e-meterai, advanced legal RAG with live regulations, multi-agent AI, full enterprise case management, automated subscription billing, notary workflows, legal outcome guarantees.

## Required analytics workstream (no agent delegation required)
Instrument product and AI usage events from Phase 0/1 onward. Implement admin-only dashboard before MVP pilot, with verified revenue and review queue metrics when corresponding modules land. Test admin RBAC, correct denominators, Jakarta timezone, retry deduplication, and payment reconciliation. Details in `ADMIN_DASHBOARD.md`.

## UI/UX release gate
Implement mobile-first screens with recoverable errors and plain-language UX. Check keyboard access, 200% zoom and screenshots on affected UI at meaningful slice/release checkpoints; do not repeat all checks for every minor artifact or edit. TEST_STRATEGY.md governs test scope. Before public launch, execute the moderated test protocol in `USABILITY_TEST_PLAN.md` with older/low-digital-literacy participants and resolve major confusion.

## Phase 1 quota acceptance
Implement atomic Jakarta-day counters and reservation/release. Verify Free 20/1 and Member 60/5, failures/retries not charged, correct plan detection, and quota visible to users. See `AI_FAIR_USAGE.md`.

## v8 — integrated delivery and test scope
Follow IMPLEMENTATION_GUIDE.md. Three dashboard shells start foundation; partner standard
notes before deep eligibility; trustworthy billing before paid deep work; extra checklist
and approval before Enhanced; QR/revocation and admin standard/deep metrics before pilot.
Build targeted acceptance checks as each slice lands. No requirement to run E2E after each
phase artifact or screen; TEST_STRATEGY.md is authoritative. Critical flows get selected E2E
on material behavior changes and release smoke before pilot. Existing production legal,
security/privacy and usability gates remain; screenshots/zoom checks follow impacted UI,
not mandatory repetition of all layouts after harmless text edits.

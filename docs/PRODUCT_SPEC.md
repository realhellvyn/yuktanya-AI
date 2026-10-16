# Product Specification

## Positioning
Yuktanya is an **Indonesian legal workspace**: accessible AI-assisted document drafting + optional affordable review by real professionals from an **exclusive partner law firm**. It is **not** a substitute for an advocate, not a law firm by itself unless separately established and permitted, and not a chatbot that guarantees legal accuracy.

Slogan: **Legal Service Seharga Secangkir Kopi.**

## Audiences
General public, students, workers, freelancers, UMKM, and businesses. Do not artificially restrict the MVP to one segment; focus initial feature coverage on three document categories.

## Initial document categories
1. **PKS** (Perjanjian Kerja Sama): parties, scope, deliverables, timeline, payment/revenue-sharing, responsibilities, termination, dispute resolution.
2. **Utang Piutang**: creditor/debtor, principal, disbursement, due dates, repayment, interest if applicable, default provisions, collateral if applicable (may require special review).
3. **NDA**: disclosing/receiving parties, confidential information, exclusions, term, permitted use, return/destruction, remedies, governing law.

All templates and clauses require **partner-law-firm review before real-user production use**. AI must ask for missing information and must not invent names, amounts, dates, statutes, or facts.

## User roles
- `user`: registered customer, free or member.
- `reviewer`: law firm professional, assigned cases only.
- `partner_admin`: law firm coordinator for assignment, quotes, case management.
- `platform_admin`: platform operations, payments, access governance.
- Optional `super_admin` only if operationally necessary.

## Value proposition
- AI document creation/editing **free** for registered users.
- Upload own PDF/DOCX for AI preliminary analysis (after login; production feature-gated until privacy, consent and security gates are approved).
- Paid professional review for standard/light documents.
- Special handling for complex/high-stakes cases, custom quote.
- Yuktanya AI Verified and Yuktanya Legal Verified evidence.
- Legal Vault and version history.

## Pricing — LOCKED
| Item | Price |
|---|---:|
| AI drafting | Rp0 for registered users |
| AI preliminary review | Intended Rp0, subject to approved fair-use policy and privacy launch gate |
| Membership | Rp19,000 per billing month |
| Nonmember standard human review | Rp50,000/document |
| Member's **first** standard human review per active billing period | Rp30,000 |
| Member's 2nd+ standard human review within same billing period | Rp35,000 |
| Complex/high-risk/special case | Custom quotation |

Membership discounts apply only while active, first-review entitlement resets each active billing period and does not carry over. Refunds, cancellation, proration, and entitlement consumption on cancelled payments are **not yet decided**.

**Financial warning:** The Rp19,000 membership plus Rp30,000 first review = Rp49,000 total for one review in the first month, vs Rp50,000 nonmember; do not exaggerate savings. Membership benefits beyond discounts (e.g. premium vault/reminders) are proposals, **not locked**.

## Core UX
Public homepage has prompt-like entry point, pricing, benefits, and CTAs. If visitor tries AI, require registration/login first. Once authenticated, launch a **Legal Workspace** (chat + live document preview on desktop; tabs on mobile). AI interview populates structured fields; deterministic renderer creates draft. Draft editing, save, version, export. Paid review is a clear optional next step.

## Human authority
AI drafts and flags risks. Only assigned licensed/qualified professional (scope to be checked) may issue human review. Platform never claims every reviewed document is legally enforceable.

## Business boundaries
- Partner law firm is exclusive for initial professional services.
- Complex cases handed off to firm, potentially via hybrid off-platform communication for MVP.
- No mandatory subscription.
- No live e-sign/e-meterai integration in first MVP unless user explicitly expands scope.
- No automated legal representation or promises of success.

## Metrics for pilot
Registration→first draft, draft completion, AI success rate, median/P95 latency, template error rate, lawyer-review request rate, quote acceptance, paid review completion time, professional correction severity, gross margin per review, complaints and privacy incidents.

## Platform admin dashboard — required MVP
Admin must see user growth/activation, AI requests and success/failure, document generation, human review requests and queue, verified revenue, membership status, special-case leads and bottlenecks. See `ADMIN_DASHBOARD.md` for KPI definitions and acceptance tests.

## Daily AI limits — LOCKED
Free users: **20 AI messages/day and 1 new document/day**; active Members: **60 AI messages/day and 5 new documents/day**, reset midnight Asia/Jakarta. Read `AI_FAIR_USAGE.md` for accounting, failure handling and UX.

## v8 — product integration
Three role-specific dashboard surfaces are required: user, legal partner/reviewer and platform
admin. Preserve reviewer and partner_admin as separate capabilities within partner surface.
Standard completed review issues Legal Verified WITH_NOTES or WITHIN_SCOPE when supported.
Deep Review is optional and ONLY follows completed standard with actionable published Legal
Notes, exact same version/hash. Price is ADDITIONAL Free Rp200.000 / active Member Rp150.000;
no first-standard discount on deep. Enhanced requires completed extra review plus authorized
professional confirmation of material criteria; payment never guarantees positive conclusion.
Add note editor, checklist/approval, QR/revocation and admin deep-revenue funnel to MVP.
Canonical details: DEEP_REVIEW.md, VERIFICATION_POLICY.md, PERMISSIONS.md, TEST_STRATEGY.md.

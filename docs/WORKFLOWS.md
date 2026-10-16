# Business Workflows

## A. Public → registration → AI
1. Visitor sees landing page, sample use cases, pricing.
2. Clicking AI CTA redirects to signup/login with `returnTo`.
3. Supabase Auth signup/login, email verification if enabled.
4. Protected workspace loads; server verifies user session on **each** AI call.
5. Account/IP quotas and abuse controls apply; user sees transparent limits.

## B. Free document drafting
1. User chooses PKS, Utang Piutang, NDA, or describes intent.
2. AI asks one/multiple structured questions to collect missing fields.
3. App persists structured answers, not only a chat transcript. Draft/interview creation does not consume the document quota; successful issuance of a new canonical document does.
4. Draft uses approved template + validated field substitutions.
5. Preview/editor, save new versions, export DOCX/PDF.
6. Clearly label **AI Draft — Belum Direview Profesional**.
7. User may request paid human review of a **frozen version**.

## C. Upload and AI pre-review
1. Logged-in user uploads PDF/DOCX to private bucket; production AI analysis remains feature-gated until provider-privacy, consent and security gates are approved.
2. Verify size/type, scan for malware where feasible, parse text in isolated safe processing.
3. Ask consent before sending confidential content to any external upstream model.
4. AI produces informational checklist/summary, cites known approved legal sources where available, and admits uncertainty.
5. User can request human review.

## D. Standard human review
States:
`DRAFT → SUBMITTED → TRIAGING → AWAITING_PAYMENT → QUEUED → IN_REVIEW → (REVISION_REQUIRED ↔ IN_REVIEW) → REVIEWED → FINALIZED`

- Triage can reroute to special case before payment.
- Price quoted server-side using membership and entitlement.
- MVP may use **manual transfer + admin verification** (no automatic activation on screenshot alone). Payment gateway later.
- Assign reviewer only after verified payment and conflict/eligibility checks as appropriate.
- Reviewer examines original document and independently assesses AI suggestions.
- Professional issues report, scope, reviewer identity, and date.
- Verification record binds immutable version hash and review report.
- User can print/wet sign or arrange other formalities separately.

## E. Special legal case
Examples: contract Rp250m/Rp1.5bn, joint venture, complex guarantees, cross-border issues, major liabilities. **Value is one signal, not the only signal.**
States:
`INTAKE → TRIAGE → USER_CONSENT → CONFLICT_CHECK → ASSESSMENT → QUOTED → ACCEPTED → ENGAGED → IN_PROGRESS → COMPLETED`
Alternative: `DECLINED`, `CANCELLED`, `QUOTE_EXPIRED`.
- AI prepares a summary but **does not issue binding professional advice**.
- Partner firm checks conflicts/capacity, proposes scope/fees, signs engagement terms as appropriate.
- For MVP, **hybrid handoff**: Yuktanya intake + status, partner may communicate/perform work directly.
- Never automatically charge Rp50k standard review for special cases.

## F. Membership and pricing
- Nonmember standard review: Rp50,000.
- Active member's first standard review in their **current billing period**: Rp30,000.
- Further standard reviews in that period: Rp35,000.
- Membership itself: Rp19,000 per billing period.
- Pricing engine computes authoritative quote; checkout reserves entitlement atomically.
- Idempotent order/payment verification.
- On failed/expired payment, reservation released.
- Membership expiration or cancellation behavior and refunds must be decided before paid rollout.
- No discount entitlement accumulation.

## G. Version-bound verification
1. Successful AI analysis may issue AI Verified; completed authorized professional review may issue Legal Verified. Enhanced follows the extra review process in DEEP_REVIEW.md.
2. Generate unique verification ID, exact SHA-256 document hash, reviewer, firm, review date, scope.
3. Public verification endpoint reveals **minimal** metadata only; no document contents.
4. Verification is **evidence of review of a specific version**, not a warranty of validity or enforceability.
5. Revisions require a new review for a new verified record.
6. Revocation/correction path and audit events required.

## H. Failure handling
- Gateway unavailable: friendly retry state; preserve entered data; no fake completion.
- Model JSON invalid: bounded repair retry, then structured manual form.
- Payment callback duplicated: idempotent.
- Reviewer unavailable: queue/reassign with access revocation.
- Template outdated: disable production generation until reapproved.
- Uploaded malicious/prompt-injection content: treat as untrusted, never execute instructions inside documents.

## I. Usage enforcement and lifecycle
Before every AI request, resolve verified membership and reserve message quota transactionally; finalize on success, release on failure. Before creating a new canonical document, reserve document quota and finalize only after durable creation. Duplicate requests use idempotency keys. Existing-document edits/exports are quota-free unless user explicitly invokes AI. See `AI_FAIR_USAGE.md`.

## v8 — standard → notes → optional deep → professional outcome
Standard paid/assigned review completes independently: WITH_NOTES (published Legal Notes)
or WITHIN_SCOPE (explicit no outstanding notes and justified scope conclusion). Incomplete
or inconclusive: no legal issuance. Report and Legal Verified commit on exact frozen hash.
Only completed standard with actionable notes and active parent verification can enter deep.
Deep offer → quote → explicit acceptance → additional verified payment → assignment → extra
work and evidence → material checklist → explicit professional decision → report/optional
Enhanced. No-note standard is already a completed standard result, never forced to deep.
Deep failures, new-version changes, payment exception/reconciliation, dependency revocation
and special-case referral follow DEEP_REVIEW.md; no auto-cap after payment or elapsed time.
Legal Note drafts and checklist draft saves are not completion or publication events.

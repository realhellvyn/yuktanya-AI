# Security, Privacy & Legal Guardrails

This document is a **product engineering checklist**, not a legal opinion.

## Must-have security
- Auth before AI; server validates session, ownership, roles, membership.
- Supabase RLS on every private table and Storage bucket; test cross-account access.
- Never expose `SUPABASE_SERVICE_ROLE_KEY` or `FREELLM_API_KEY` in client bundles.
- TLS, encryption at rest from providers, short-lived signed file access.
- Validate upload type by content and extension, size, parsing limits; isolate parsers and sanitize rendered content.
- Rate limiting and quotas per account/IP; anti-bot controls; safe error handling.
- Audit log for review, verification, role changes, payment changes, and file access where practical.
- Secrets rotation, backups/restore testing, incident response, data retention/deletion process.
- Minimal collection of personal data; redact logs and telemetry.
- Prevent IDOR, SSRF, XSS, SQL injection, CSRF as relevant, prompt injection and model-output HTML injection.
- Explicit user consent and provider privacy assessment **before sending confidential document text to FreeLLMAPI upstream providers**. Gateway ownership does not mean upstream processing is private. Until upstream conditions are confirmed, block confidential uploads/analysis in production, not merely show a disclaimer.
- Evaluate data residency/cross-border transfers and provider retention/usage conditions.

## Legal and professional review required
- Indonesia's personal data protection framework (including UU PDP) and applicable implementing requirements.
- Indonesian electronic systems/consumer requirements as applicable.
- Law firm professional conduct, licensing, client relationship, confidentiality, and **referral/fee-sharing** restrictions.
- Electronic signatures and certified provider requirements; not every document needs e-meterai and not all documents can be fully executed electronically.
- The nature and limits of notarial acts and any mandatory formalities.
- Consumer disclosures, review scope, refunds/cancellation, professional liability and dispute handling.
- Accuracy and currency of Indonesian laws and template clauses.
- Commercial permissions and data-processing terms for every upstream **free LLM API**.
- Vercel Hobby/commercial-use restrictions and other service terms before paid launch.

## Mandatory copy
- AI draft label: **"Dibuat dengan bantuan AI. Belum diperiksa oleh profesional hukum."**
- AI pre-review: **"Analisis awal AI bersifat informasional dan dapat keliru."**
- Verified label: **"Dokumen versi ini telah diperiksa oleh profesional hukum sesuai ruang lingkup review yang tercantum. Tidak menjamin keabsahan atau hasil hukum tertentu."**
- Special case: **"Biaya dan ruang lingkup ditentukan setelah asesmen profesional."**

## Production launch gates
- Partner law firm signs off on templates, reviewer roles, scope, disclaimers, commercial arrangement.
- Independent RLS/security review and cross-tenant tests.
- Consent/privacy terms published and data-flow inventory completed.
- Upstream API commercial terms confirmed.
- Hosting suitable for commercial operations.
- Payment reconciliation and refund rules tested.
- Synthetic-case legal quality benchmark passes agreed criteria.

## Required threat scenarios before pilot
- Abuse: mass signup, shared accounts, credential stuffing, repeated failed gateway calls, AI regeneration and document-clone quota bypass.
- Authorization: object ownership and RLS on every API route, storage signed URLs, partner assignment changes, admin role escalation and SSRF through document references.
- Billing: fake proof-of-payment, duplicate webhook, membership entitlement granted on pending payment, concurrent first-review discounts and refunds/revocations.
- Verification: public verification code enumeration, leaked PII, hash mismatch after export, forged QR and stale/revoked certificate. Use non-guessable codes, rate limits, minimum public fields and consent.
- LLM: prompt injection from uploads, provider data retention, malicious JSON, fabricated clauses, unsafe rendering, request timeouts and partial streams.
- Human factors: readable consent, non-misleading pricing and accurate scope.

## v8 — additional threats and gates
Reject forged deep eligibility, AI-generated note pretending professional authorship, stale
standard parent, cross-version approval, concurrent duplicate checkout, checklist tampering,
admin professional impersonation, revoked credentials, stale report tabs, forged QR origins,
hash confusion between original and stamped exports, and public stale revocation caching.
Test authorization again at final transaction; trusted payment is never legal authority.
Append-only audit includes report/notes publication, checklist/approval, hash mismatch,
eligibility rejection, payment/reconciliation, issuance, revocation/dependency and role changes.
No raw legal notes/evidence bodies in operational telemetry. Private evidence retention and
professional confidentiality require approved policy. Scope/criteria wording, negative legal
results, Enhanced cap/claims, extra fee/refund disclosures and professional authority need
partner/legal signoff before enabling real paid deep work. No new claim of statutory legality
or compliance is made in this blueprint; legal/source research remains partner responsibility.

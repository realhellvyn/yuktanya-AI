> HISTORICAL AUDIT: describes its original version only. Current decisions: DECISIONS_AND_PRECEDENCE.md and AUDIT_REPORT_v8.md.

# Blueprint Audit v6 — 16 Oktober 2026

## Scope and limitations
Static consistency and security/product-design review of the handoff specifications. **Not** a source-code test, legal opinion, gateway connectivity test, current service-terms verification, or production security audit. No functioning app or SQL migrations were present to execute.

## Corrections applied
1. Consolidated conflicting/repeated quota rules into canonical `AI_FAIR_USAGE.md` and decision precedence file; Free 20/1, Member 60/5.
2. Resolved Phase 1 vs Phase 4 sequencing: test-only membership fixture early, real membership after verified payment later; quotas still server-enforced from first AI request.
3. Closed potential unmetered AI pre-review loophole with explicit production feature flag OFF pending owner decision; no fabricated quota.
4. Clarified what consumes message quota vs new-document quota, including AI edits, retries, regenerated drafts, clones, versioning and failure recovery.
5. Clarified active membership on upgrade/expiry and Jakarta-day counters; server-side entitlements and transactional reservations.
6. Strengthened atomic first-review discount constraint (reserved OR consumed, not consumed-only).
7. Clarified exact reviewed byte artifact/hash vs potentially different PDF/DOCX export hashes.
8. Strengthened privacy and abuse threat checklist and public verification protections.
9. Removed mutable `FREELLM_MODEL` environment override; hard-code `model: "auto"` on every AI call.
10. Kept accessible UI/UX and admin dashboard as required, with real-data-only metrics.

## Remaining blockers (cannot responsibly assert resolved)
- FreeLLMAPI exact endpoint, provider retention, commercial use and data permissions.
- Partner law firm legal approval of templates, qualifications, review SLA, referral arrangement.
- AI pre-review quota policy choice by owner.
- Membership renewals/refunds/cancellations and payments settlement process.
- Hosting terms and capacity for commercial deployment.
- Actual implementation of RLS, migrations, code, tests and usability study with older adults.

## Recommendation
Treat v6 as a corrected **specification** for Claude Code, not production certification. Build in stages; enforce security/quotas from day one and require written signoffs before accepting real confidential legal documents or payments.

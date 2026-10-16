# Open Questions — Ask User/Partner; Do Not Assume

## Blocking for production
1. AI pre-review quotas are decided: Free 2/day and Member 10/day, each consuming 1 message; production still requires upstream privacy/consent/security clearance.
1. Exact `FREELLM_BASE_URL` including `/v1` prefix; auth header; request/stream behavior; maximum payload size; whether gateway returns model/provider metadata.
2. Which upstream free APIs may receive confidential data? Terms, commercial rights, retention, geography, model quality allowlist.
3. Partner firm legal entity, reviewer qualifications, review scope, SLA, turnaround, capacity, legal ethics/commercial arrangement.
4. Partner-approved versions of PKS, Utang Piutang and NDA templates, source legal references and update owner.
5. What qualifies as a **standard/light review** (page count, category, risk thresholds, revision count), and when special-case triage overrides it?
6. Privacy notice, consent wording, retention/deletion policy, data processing arrangements.
7. Suitable hosting for **commercial** launch, current free-tier limits and projected capacity.
8. Payment process, invoices, refund/cancellation rules, dispute resolution, membership renewal and failed payments.

## Nonblocking for early prototype
- Brand visual identity/logo, final typography, marketing copy.
- Whether Google OAuth is enabled on day one.
- Whether partner reviews entirely in portal or uploads an offline-reviewed file (MVP can support upload result).
- Whether legal reminders or premium Vault are membership benefits (not yet locked).
- Future e-sign/e-meterai provider.
- Exact value threshold for special cases; use conservative configurable flags and manual triage, never imply all low-value cases are safe.
- User-facing legal education/knowledge-base rollout.
- Whether user wants auto-renewing membership or manual month-to-month purchase; pricing is agreed but renewal mechanism isn't.

## v8 — additional production decisions (do not invent approvals)
- Partner signoff of M1–M7 material rubric and document-specific thresholds/evidence, any
  allowed N/A, authority levels, final Enhanced branding and adverse standard outcome wording.
- Deep scope/page/risk limits, included revision rounds, turnaround/capacity, price economics,
  whether/when repeat deep work is allowed, refunds/credits if findings remain or scope changes.
- Quote validity TTL, pending-to-settled membership pricing contract, late payment, parent
  revocation after payment and user-selected version changes: conservative defaults documented
  in DEEP_REVIEW.md need commercial confirmation before paid production.
- Public scope/issuer disclosure, private notes/evidence retention, revocation handling and
  dependent Enhanced suspension workflow require approved policy and responsible operator.
These do not block synthetic scaffolding. Existing gateway/provider/hosting/renewal/payment
and legal-professional launch gates remain unresolved. Quotas and deep fees are decided.

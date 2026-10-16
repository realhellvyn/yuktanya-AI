# Data Model & Access

Use Supabase migrations, SQL constraints, indexes, RLS and explicit grants. This file is a **schema contract**, not a completed migration.

## Core entities
- `profiles(id uuid PK references auth.users, display_name, created_at)` — avoid putting authoritative roles in user-editable metadata.
- `user_roles(user_id, role, granted_by, created_at)` — admin-managed, server-enforced.
- `memberships(id, user_id, status, period_start, period_end, payment_id, created_at)` — server-verified paid periods determine active entitlements; pending orders never grant Member quotas.
- `document_templates(id, category, version, schema_json, template_path, approval_status, approved_by, approved_at)` — only approved templates served in production.
- `documents(id, owner_id, category, title, current_version_id, created_at, updated_at)` — logical container.
- `document_versions(id, document_id, version_no, structured_data, file_path, sha256, status, created_at)` — freeze bytes and hash for submitted/reviewed versions; editable drafts must create a NEW version when frozen, never mutate reviewed bytes.
- `review_requests(id, document_version_id, user_id, review_type, status, quote_id, created_at)` — never repoint version silently.
- `review_assignments(id, review_request_id, reviewer_id, assigned_at, status)` — scope access.
- `review_reports(id, review_request_id, reviewer_id, scope, findings, result_file_path, completed_at)` — final professional output.
- `document_verifications(id, review_report_id, document_version_id, verification_code, document_sha256, reviewer_display, scope_summary, issued_at, revoked_at)` — public verification exposes only minimal consented metadata.
- `legal_cases(id, owner_id, document_version_id, status, intake_json, assigned_firm_id, created_at)` — special case.
- `legal_case_quotes(id, legal_case_id, price_idr, scope, expires_at, status)` — approved professional proposal.
- `orders(id, user_id, kind, status, total_idr, currency, idempotency_key, membership_period_id, created_at)` — authoritative pricing snapshot.
- `payments(id, order_id, provider, provider_ref, status, verified_at)` — no trust in browser redirect.
- `review_discount_entitlements(id, membership_id, billing_period_start, billing_period_end, order_id, status)` — reservation/consumption ledger for first-review discount.
- `audit_events(id, actor_id, event_type, entity_type, entity_id, metadata_safe, created_at)` — redact sensitive fields.

## Important constraints
- Money in **integer IDR**, never floating point.
- `document_versions`: unique `(document_id, version_no)`.
- `orders`: unique `(user_id, idempotency_key)`.
- `document_verifications`: unique `verification_code`.
- First-review discount: enforce one **active reserved OR consumed** entitlement per membership billing period via a partial unique constraint / transaction-safe ledger, not merely one consumed entitlement. Release/expire on failed payment, and settle/reconcile consistently.
- Store precise time boundaries with timezone-aware timestamps; determine period from membership records, not calendar month.
- Do not issue LEGAL or LEGAL_ENHANCED verification on AI-only drafts. AI verification requires successful persisted preliminary analysis; legal kinds require authorized completed professional review.
- Any edit to reviewed version creates a new version without inherited verified status.
- Avoid unrestricted cascading deletion of legal/audit records; implement retention/deletion policy after legal consultation.

## RLS matrix
| Entity | Owner user | Assigned reviewer | Partner admin | Platform admin |
|---|---|---|---|---|
| Own documents/versions | Read/write drafts | Read assigned only | Limited assigned firm cases | Restricted operational access |
| Review request | Read own/create | Read assigned/update scoped | Assign/coordinate firm cases | Support and audit |
| Review report | Read own | Write assigned | Read firm cases | Limited support |
| Membership/orders | Read own | No | No | Billing administration |
| Verification public view | Minimal metadata only | As needed | As needed | Manage/revoke |

All Storage buckets private; use short-lived signed URLs after server-side authorization, never public file URLs. Implement Storage RLS/path authorization. Separate public verification projection from private source tables. No direct client updates to membership, roles, pricing, approval, or verification.

## Migration plan
1. Profiles/roles and auth hooks.
2. Templates/documents/versions and private storage.
3. Review requests/assignments/reports and audit.
4. Membership/orders/payments/discount ledger.
5. Special cases/quotes.
6. Verification records and safe public verification endpoint.

**Migration files intentionally not fabricated:** Generate and test actual SQL RLS policies with Supabase tooling in the implementation environment. Empty `supabase/migrations/` is expected in this handoff.

## Analytics tables
Add `product_events`, `ai_request_metrics`, and optional `daily_metrics` rollups as specified in `ADMIN_DASHBOARD.md`. Use server-authoritative events, RLS denying non-admin access to aggregates and limiting writes to trusted server paths. Never include document bodies or raw prompts in metrics.

## AI quota schema and migration order
Implement `ai_usage_daily` and `ai_usage_reservations` as in `AI_FAIR_USAGE.md` during Phase 1, before exposing real gateway calls. A server-only `resolve_entitlement(user_id, now)` checks verified paid membership periods; Phase 1 mock membership fixtures are test-only. Add constraints on nonnegative counters and uniqueness/idempotency. No client update permissions for quota tables.


## Canonical baseline verification fields (extended below in v8)
`document_verifications(id, kind, document_version_id, sha256, status, issued_at, revoked_at, scope, outcome, ai_request_id, reviewer_id, firm_id, review_id, limitations, audit_event_id)` with kind-specific NOT NULL constraints. AI requires successful persisted report, legal requires authorized completed review. Version/hash immutable. `ai_review_daily` or quota_type in shared ledger for Free 2 / Member 10 daily successful AI analyses, atomically reserved alongside AI message. Do not expose report contents in public verification lookup.

## v8 — canonical schema additions and reconciliation
Use `document_verifications` as the ONE canonical verification entity; older
`verification_records` is legacy naming, not a second competing table. Preserve legacy IDs
through migration/view mapping. Use review_reports as the professional report entity.
Exact SQL migrations must be generated/tested in implementation environment.

| Entity / addition | Required fields and invariants |
|---|---|
| firms / professional_authorizations | firm, reviewer, credential/scope, validity, verified_by/at, revoked_at; verified snapshot saved at approval |
| review_requests | review_type STANDARD/DEEP; parent_standard_review_id; fixed version/hash; owner/firm; lifecycle status; completed_at; outcome separate |
| review_reports | draft revision, finalized_at, signed_off_by, scope, assumptions, conclusion, rubric/policy version; final immutable |
| legal_notes | report revision, anchor, title, finding, severity, actionable, action, evidence_requested, author, visibility; final published notes immutable |
| deep_note_resolutions | deep report + parent_note_id, disposition, evidence, rationale, assessed_by/at; do not mutate parent notes |
| review_checklist_items | report, criterion ID, policy version, assessment PASS/FAIL/UNKNOWN/N_A, justification, evidence IDs, assessor/time |
| review_approvals | report revision, decision, reviewer/authority snapshot, attestation, target hash, decision_at; append-only |
| pricing_quotes | owner, service, parent/target/hash, integer IDR, plan/period snapshot, policy version, expires_at, accepted_at |
| orders/payments | quote_id, kind STANDARD/DEEP/MEMBERSHIP/SPECIAL, settlement/refund references; verified money only |
| document_verifications | kind AI/LEGAL/LEGAL_ENHANCED; exact hash/version; report/request references; unique code; issuer snapshot; status and revocation references |
| verification_dependencies | enhanced_id, parent_legal_id; revoke/suspend dependency propagation |
| verification_revocations | verification_id, reason_code, private_reason, actor/time; append-only; no silent undo |
| evidence_artifacts | private file path, hash, owner/review scope, access/retention metadata |
| ai_review_reports | logical AI request, immutable version/hash, saved validated analysis, analyzer/prompt policy versions, completed_at; AI verification source, not professional approval |
| audit_events/outbox_events | actor/capability, action, entity, safe before/after IDs, reason, UTC, correlation/idempotency; restricted append-only |

Constraints: DEEP requires parent STANDARD (never DEEP), same owner/document/version/hash,
completed published actionable-note parent verified active. Enforce cross-row invariants in
transactional RPC/trigger, not client or simple CHECK alone. Partial unique live DEEP parent
index plus completed-deep policy prevents double charging; reject concurrent duplicate orders.
Unique finalized verification `(kind, review_report_id)` for legal kinds; unique logical AI
report verification; unique provider event/ref and outbox event key. Notes/checklist references
must belong to same report/version. Prevent overwrite/delete finalized evidence with DB grants
and triggers; hash is server calculated. Positive integer IDR, valid statuses, FK constraints.
AI kind requires successful saved analysis/request; LEGAL requires authorized completed
standard report; Enhanced requires completed extra report + APPROVE + material checklist.
Kind-specific non-null checks and server/DB transaction guard. Revoked/suspended never active.
RLS for every new table follows PERMISSIONS.md, not blanket reviewer/admin grants.
Canonical quota ledger includes review units atomically alongside message units; retain
first-standard reserved-or-consumed discount ledger. Use UTC instants + WIB bucket keys.

# Admin Analytics & Operations Dashboard — Yuktanya

## Objective
A **platform-admin-only** dashboard to understand acquisition, AI usage, legal review demand, revenue, conversion, bottlenecks, quality and operational risks. This is a **required MVP module**, not a deferred feature.

## Routes and roles
- `/admin` executive overview
- `/admin/analytics` funnel and trends
- `/admin/ai-usage` gateway performance
- `/admin/reviews` review operations and SLA
- `/admin/revenue` revenue, memberships and reconciliation
- `/admin/users` user growth and activation
- `/admin/incidents` failed requests, errors and alerts

Only `platform_admin` role can access these pages and associated API queries. Use server-side RBAC plus Supabase RLS / secure server-side aggregation. Do not grant blanket access to private contract content. Log admin actions.

## KPI dictionary
| KPI | Definition / denominator | Notes |
|---|---|---|
| Total registered users | Count of created user accounts | Exclude internal/test users where flagged |
| DAU / WAU / MAU | Distinct users with meaningful product event in last 1/7/30 days | Show definition |
| New users | Registered accounts in selected interval | |
| Activated users | Users completing first draft | Compare to signups |
| AI requests | Total gateway attempts by status | Separate logical requests from retries |
| AI success rate | Successful logical AI requests / completed logical AI requests | Exclude still-pending |
| AI P50/P95 latency | Duration of logical AI requests | In ms or seconds |
| AI failures | Count by HTTP class, timeout, malformed output, provider unavailable | No prompt text in logs |
| AI volume per user | Requests / active AI users | For abuse/capacity |
| Drafts generated | Count of finalized draft versions | Distinguish draft starts |
| Draft completion rate | Users completing draft / users starting document flow | Cohort/time-window consistent |
| Review submissions | Submitted standard reviews | Distinguish paid, pending, cancelled |
| Review conversion | Paid standard review orders / completed drafts (eligible cohort) | Label denominator clearly |
| Review backlog | Paid/accepted requests not completed | By aging bucket |
| Review SLA | Median/P95 time from payment verified to review completion | SLA target is TBD |
| Special-case leads | Legal cases submitted | Quote conversion separate |
| Quote acceptance | Accepted special-case quotes / quotes sent | |
| Gross revenue | Sum verified settled successful payments | Distinguish refunds and net receipts |
| Refunds | Sum refunded amounts | |
| Net collected | Gross collected minus refunds | Excludes firm payouts, taxes, infra |
| Membership MRR | Active recurring subscriptions × Rp19k only if actually auto-renewing | If manual month-to-month, label monthly membership revenue instead; do not mislabel MRR |
| Paid memberships | Count active members / newly paid memberships | |
| ARPPU | Net collected / unique paying users | |
| Revenue by service | Standard reviews, deep reviews, memberships, special cases | |
| Gross margin estimate | Net receipts - partner payouts - transaction costs - attributable AI costs | Only if costs recorded; otherwise show N/A |
| Incidents | Error counts and unresolved operational alerts | No sensitive details |

## Default dashboard layout
- Date selector: today, 7d, 30d, custom; timezone **Asia/Jakarta**. Comparison to previous equal interval.
- KPI cards: registered users, active users, AI requests, AI success %, generated documents, review requests, paid reviews, collected revenue, active members.
- Trends: daily users, AI requests/success/fail, review funnel, revenue.
- Funnel: registered → AI used → document started → draft completed → review requested → review paid → review completed.
- Operations panel: pending payments, reviews awaiting assignment, overdue reviews, special-case quotes pending, AI outage/error spike.
- Quality panel: malformed structured outputs, human review corrections, verified count, complaints.
- Segment/filter by document type, membership, date, user acquisition source if available; avoid identifying individual legal case content in aggregated charts.
- Always show `no data` instead of fabricated zeros when telemetry is missing.

## Minimal event instrumentation
Store sanitized, typed product events:
`signup_completed`, `ai_request_started`, `ai_request_succeeded`, `ai_request_failed`, `document_started`, `draft_completed`, `review_requested`, `review_payment_verified`, `review_assigned`, `review_completed`, `special_case_submitted`, `quote_sent`, `quote_accepted`, `membership_activated`, `payment_refunded`, `ai_verification_issued`, `legal_verification_issued`, `legal_enhanced_verification_issued`, `verification_revoked`.

Suggested tables:
- `product_events(id, actor_user_id nullable, event_name, entity_type nullable, entity_id nullable, occurred_at, metadata_safe jsonb)`
- `ai_request_metrics(id, user_id, request_id, logical_request_id, task_category, status, latency_ms, attempts, provider_label nullable, model_label nullable, error_category nullable, occurred_at)`
- `daily_metrics(day_local, metric_name, dimension_json, value_numeric, calculated_at)` optional rollup for scale.

Events should be written server-side after verified state transitions. Make events idempotent (deduplication key), distinguish attempts/retries, and prevent arbitrary client injection into revenue numbers. Keep raw user document text, chat prompts, full names, API keys, and confidential details OUT of analytics.

## Diagnostics and alerts
- AI success below threshold, gateway 429/5xx spike, P95 latency spike.
- Pending review > agreed SLA, unassigned queue growing.
- Payments received but review not queued, reconciliation mismatches.
- Review refunds, complaints, verification issuance failures.
- Start with configurable in-dashboard alerts and admin notices; external notifications later.

## Security and business accuracy
- Analytics only for platform admins; deny reviewer and normal user.
- Query aggregate metrics server-side; apply rate limits.
- Show revenue only from verified payments, not unverified screenshots or submitted orders.
- Label financial data as **collected revenue**, not profit. Profit requires actual cost and payout accounting.
- Implement admin audit events for role changes, payment confirmation, and reviewer assignments.
- Privacy-preserving retention and event schemas, minimal PII, restricted exports.

## Acceptance criteria
1. Ordinary users/reviewers receive 403 for all admin pages/APIs.
2. Dashboard updates after real signup, AI request, draft completion, review submission and verified payment.
3. Time filtering and Jakarta-local daily aggregation produce correct totals across UTC boundaries.
4. Failed and retried AI requests are not double-counted as user actions.
5. Revenue never increases before verified settlement.
6. Admin can locate bottlenecks from funnel and backlog without viewing private document content.
7. Empty data displays honest empty states.

## Daily quota control
Default daily quotas: Free **20 AI messages/1 document**, Member **60 AI messages/5 documents**. Admin sees quota rejections, usage distributions, global capacity, and audited configurable limit controls. See `AI_FAIR_USAGE.md`.

## v8 — revenue funnel and operations extension
Break verified gross collected, refunds and net collected out by STANDARD, DEEP, MEMBERSHIP,
SPECIAL. Never add standard+deep bundled projections to actual cash. Margin needs recorded
partner payout, fees, attributable costs; missing data shows N/A. Manual membership is not MRR.
Deep cohort funnel: eligible completed standards → distinct offer shown → quote accepted →
verified deep payment → extra review completed → Enhanced approved. Count distinct parent
review IDs within the same eligibility cohort; separately show events occurring in date window.
Offer conversion = paid deep parents / eligible parents for cohort, with maturity/date label.
Enhanced rate = approved completed deep / completed deep; never treat this as a sales target
that incentivizes positive legal conclusions. Show counts/denominators, zero denominator N/A.
Ops: standard vs deep backlog, unassigned paid work, median/P95 queue/turnaround, missing
evidence, pending decisions, failed/unknown criteria, revoked parent dependencies, checkout
eligibility failures, duplicate callbacks, reconciliation holds, complaints, refund age,
credential expiry and verification failure/revocation totals. SLA only after partner agreement.
New events (safe IDs only): standard_completed, legal_note_published, deep_eligible,
deep_offer_shown, deep_quote_accepted, deep_payment_verified, deep_assigned, deep_completed,
deep_approval_recorded, legal_enhanced_verification_issued, verification_revoked.
Use trusted transitions + transactional outbox; dedupe event key. UI offer events are validated
exposure analytics only, never authority for eligibility, payment or legal approval.
Payment/revoke/support actions require separate capabilities and audited reason; admin
analytics never grants professional review or unrestricted confidential-file access.

## Implementation status (v8, Task 7)
- Catalogue: `src/lib/analytics/catalogue.ts` lists all 28 unique event names named above (19 minimal + 9 additional v8; `legal_enhanced_verification_issued` and `verification_revoked` appear in both lists). The three special-case events are recorded under the names chosen in Task 5: `special_case_submitted` → `special_case_requested`, `quote_sent` → `special_case_quote_sent`, `quote_accepted` → `special_case_quote_accepted`. Two extra events were added for uploads and AI review: `document_uploaded`, `ai_review_completed`. Consent records (`ai_review_consent_given`, `document_upload_consent`) are not analytics and stay strict.
- Writer: single DB function `record_product_event` (catalogue-checked name, dedupe key, allow-listed scalar metadata via `analytics_safe_metadata`, best-effort: failure never aborts the business transaction). State-transition events come from `analytics_capture` triggers on source tables (migration 33); AI request events and `deep_offer_shown` come from server code via `trackEvent`.
- Dashboard numbers (`admin_analytics`) are computed from source tables; only AI failures/malformed outputs (which have no other source) come from events. Complaints have no source table yet and display "Belum ada data".
- Alert thresholds are provisional engineering defaults (review queue 72 hours, AI error rate 20% with at least 5 requests in 24 hours), configurable via `app_settings` keys `ADMIN_REVIEW_OVERDUE_HOURS` and `ADMIN_AI_ERROR_RATE_ALERT`; SLA still requires partner agreement.

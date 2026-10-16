# AI Fair Usage — Canonical v8 (v6/v7 accounting preserved)

## Plan limits and reset
| Plan | Successful user-initiated AI messages per WIB calendar day | Successfully generated NEW canonical documents per WIB calendar day |
|---|---:|---:|
| Free | 20 | 1 |
| Active Member (Rp19.000/billing period) | 60 | 5 |

Reset at **00.00 Asia/Jakarta**. Store UTC timestamps and compute the user's daily bucket in Asia/Jakarta; never use server-local timezone. Membership status must be authoritative server-side, based on a verified paid period; a pending order does not grant Member quotas. If user upgrades during a day, usage already consumed remains; higher ceiling applies immediately after verified activation. If membership expires or is revoked during a day, Free ceiling applies to remaining usage (floor remaining at zero), without deleting prior completed work. Show actual `resetAt` from backend, not hardcoded client time.

## Counting semantics
- One **successful user-initiated AI action/message** = one message unit. Retries, structured-output repair, internal gateway calls and streaming chunks for the SAME logical action do not consume extra units. A user clicking "Regenerate" is a new action and costs one unit.
- Reserve one unit atomically **before** gateway call, finalize on successful completion, release on definitive upstream/server failure or timeout; orphan reservations expire and are reconciled. A partial streamed response should count only when a defined successful completion is recorded. Prevent repeated free retries from hammering the gateway via separate failure/attempt rate limits.
- One document unit is finalized when a **new canonical document** is successfully generated and durably saved. An unfinished interview, preview-only, failed generation, manual edit, version update, re-export, or download does not consume a new-document unit. A new canonical document created by cloning/copying an existing document **does** consume one unit. The same idempotency key must return the same result rather than create a second document.
- If generation invokes AI because of an explicit user action, count the message unit as well as the document unit. Pure deterministic approved-template rendering without AI does not consume message units. Explain this in product copy where applicable.
- **AI Document Review (pre-review): Free 2 successful analyses/day; Member 10 successful analyses/day. Each successful analysis ALSO consumes 1 of the daily AI message allowance** (20 Free / 60 Member). Reserve both counters atomically before the upstream call and finalize both on successful saved analysis; release both on failure. User-triggered re-review of a changed version counts as another review and another message. Never count an internal retry twice.
- Default per-analysis maximum: Free **10 pages**, Member **20 pages**, pending real benchmarking; also enforce upload byte size, extracted text length, input/output token caps, MIME validation, malware scanning and no unlimited repeated analysis. If PDF page count cannot be trusted, enforce server-side extracted text/token cap.
- Production AI pre-review requires confirmed upstream privacy/commercial suitability and user consent, plus passing security and review-policy checks. Feature flag may be enabled only after these gates, not merely because quota is now decided.
- Manual editing, saving, opening, downloading existing documents do not consume AI quotas. A request that edits text *with AI* is a new user AI action and consumes a message.

## Concurrency, abuse and infrastructure
- Postgres transaction-safe reservation ledger and counters (unique `(user_id, local_date, quota_type, idempotency_key)` or equivalent). Use one active upstream AI call/user by default; handle concurrent document creation with atomic reservations.
- Enforce server-side per-user quotas, account/IP burst rate limits, size limits, per-request token/output caps when supported, global upstream concurrency, circuit breaker, backoff and provider 429 handling.
- Do not trust client-supplied plan, counters, timezone, role, user_id, or document ID ownership.
- `GET /api/usage` authenticated, with `plan`, `messageLimit`, `messagesUsed`, `messagesRemaining`, `documentLimit`, `documentsUsed`, `documentsRemaining`, `resetAt`, `aiReviewLimit`, `aiReviewsUsed`, `aiReviewsRemaining`.
- 429 with stable code `AI_MESSAGE_QUOTA_REACHED` or `DOCUMENT_DAILY_QUOTA_REACHED`, `retryAfter` or reset time; show a calm Bahasa Indonesia explanation and allow non-AI work to continue.
- Configurable plan defaults by platform_admin only; changes audited and server-validated. Initial locked defaults are 20/1 and 60/5.
- Server-side safe analytics: successes, attempts, failures, latency, rejection reason and plan. Never log prompts/document bodies.

## Test cases
1. Free: 20th AI message succeeds, 21st blocked; 1st document succeeds, 2nd blocked.
2. Member: 60th message succeeds, 61st blocked; 5th document succeeds, 6th blocked.
3. WIB midnight with UTC boundary; upgrade and expiry midday; expired plan cannot use Member limit.
4. Two simultaneous calls near quota cannot both over-consume; stale reservations recover.
5. Gateway timeout, duplicate submission, partial streaming, regeneration and internal retry semantics.
6. Cloned new document counts; versions, downloads and manual edits do not.
7. Free AI reviews: 2nd succeeds, 3rd blocked; Member: 10th succeeds, 11th blocked; each successful review consumes one message; failed reviews consume neither.
8. AI pre-review production remains gated by privacy/security/partner-approved messaging, not quota indecision.

## v8 preservation
Deep Review is paid human work, not an AI quota unit. Standard/deep completion never consumes AI quotas by itself. Any separately requested AI action still follows this ledger. Human Legal Notes never count as AI review eligibility.

# UX & Page Specification

## UX principle
**ChatGPT-simple entry; professional legal-document workspace after starting.** Users are here to complete a legal task, not merely chat.

## Routes
Public:
- `/` — homepage, hero, product benefits, 3 sample document types, trust disclosures, signup CTA.
- `/pricing` — clear standard review and membership table, special-case custom quote.
- `/login`, `/register`, `/auth/callback`.
- `/verify/[code]` — minimal verification metadata, no contract contents.
- `/privacy`, `/terms` — real legal text required before launch; no invented policies.

Authenticated:
- `/dashboard` — recent documents, create/upload CTAs, membership state.
- `/workspace/new` and `/workspace/[documentId]` — AI interview + document preview/editor.
- `/documents` and `/documents/[id]` — versions, exports, review requests.
- `/reviews` and `/reviews/[id]` — review status, results, feedback.
- `/vault` — private document library.
- `/membership` — subscription, current-period discount usage, payments.
- `/settings` — account, security, deletion/export controls.

Partner:
- `/partner/queue` — assigned review queue.
- `/partner/reviews/[id]` — document access, findings, revisions, completion.
- `/partner/cases` — special case assessment and quotation.
- `/partner` is the legal partner dashboard; coordinator permissions stay firm-scoped. Platform support/payment/role administration lives under `/admin`, outside the partner role.

## Workspace
Desktop: left conversational interview panel; right structured document preview/editor.
Mobile: switchable `Chat` / `Dokumen` tabs.
- Display progress through required fields and missing information.
- Save work incrementally; don't lose data when LLM fails.
- User confirms facts before draft generation.
- Show template version and draft disclaimer.
- Human review CTA is explicit, optional, and not confused with AI pre-review.

## Signup
Visitor may explore marketing pages but **cannot use AI until registered and logged in**. Support email/password; Google login if configured. Email verification recommended. Redirect to intended action after login.

## Tone
Warm, clear Indonesian, minimal legal jargon. Transparent pricing and scope. Never use manipulative urgency or claim a draft is automatically valid.

## Accessibility
Keyboard navigation, clear labels, WCAG-aware contrast, responsive mobile design, loading states, errors, file upload progress.

## Admin UX — required
Create `/admin` with KPI cards, trends, conversion funnel, review backlog, revenue breakdown, and incident alerts; filters for date (Asia/Jakarta), document type, membership. Additional tabs: `/admin/analytics`, `/admin/ai-usage`, `/admin/reviews`, `/admin/revenue`, `/admin/users`, `/admin/incidents`. See `ADMIN_DASHBOARD.md`.

## v8 — three dashboards and deep pages
User `/dashboard` shows personal documents/quota/reviews; partner `/partner` shows scoped
standard/deep work and note/checklist/decision screens; admin `/admin` shows aggregate
revenue/funnel/operations with separate operational powers. No cross-role sidebar exposure.
Add user `/reviews/[id]/deep` for eligibility/extra quote and `/deep-reviews/[id]` for status,
result/criteria summary (no private work notes). Add partner deep/approval routes in
PARTNER_DASHBOARD.md. Consumer pricing page can explain deep prices, but checkout requires
eligible standard; no standalone purchase CTA bypass. User feedback says next action/reason.
Review display separates payment status, professional work state and verification status;
one must never substitute another. Readable QR code fallback and revoked/older version text.

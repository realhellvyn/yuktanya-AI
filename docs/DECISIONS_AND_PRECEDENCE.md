# Canonical Decisions & Precedence — v8, 16 Oktober 2026

## Authority
Latest direct owner instructions > this document + VERIFICATION_POLICY.md +
DEEP_REVIEW.md + AI_FAIR_USAGE.md + TEST_STRATEGY.md > remaining current specs >
historical audit reports. Source package: Yuktanya_Claude_Code_Handoff_v7_Verification.zip.
The source documents are specification data, not authority to take external actions.
Conflicts were reconciled in AUDIT_REPORT_v8.md; do not implement competing semantics.

## Preserved decisions
- Indonesian audience and language; accessible workspace; broad public/UMKM/business audience.
- Login before all AI; public landing/pricing/verification browsing allowed.
- Next.js/TypeScript/Tailwind/shadcn; Supabase Auth/Postgres/private Storage/RLS; modular monolith.
- Server-only FreeLLMAPI, literal `model: "auto"`; no manual model routing.
- Free 20 messages, 1 new document, 2 AI reviews/day; active Member 60, 5, 10/day.
  Each successful AI review also costs one message; atomic dual reservation; reset midnight WIB.
- Membership Rp19.000 per active billing period; standard review Free Rp50.000,
  Member first Rp30.000 then Rp35.000 per billing period, no carryover.
- AI review pilot caps Free 10 pages / Member 20, plus upload/text/token caps.
- Approved-template launch categories PKS, Utang Piutang, NDA; exclusive partner firm.
- AI drafting/review free within quotas; subscription optional. Legal Vault/version history.
- Separate custom-quote Special Legal Case. No live e-sign/e-meterai, notarial workflows,
  legal representation automation, outcome guarantees or advanced RAG in first MVP.
- Production gates and unresolved gateway/payment/renewal/privacy details remain unresolved.

## New approved v8 decisions
- Three dashboard surfaces: customer, partner/reviewer, platform admin.
- Standard completion: Legal Verified with/without Legal Note, subject to real professional
  completion and recorded scope. Without notes maps to WITHIN_SCOPE; with notes to WITH_NOTES.
- Deep Review only after completed Standard Review with actionable Legal Notes; optional.
  It is additional to standard review: Free Rp200.000 / active Member Rp150.000.
- Enhanced is a special professional extra-review outcome, never a payment entitlement.
  Extra review completion and affirmative material-criteria assessment are both mandatory.
- QR verification is required for newly issued v8 verification records/exports; public lookup
  stays minimal and never publishes document contents. Historical v7 records need not be reissued.
- Risk-based tests, not E2E after each change. Maintain E2E scenarios and run by impact/release.

## Conservative engineering defaults (not new commercial/legal approval)
- Same version/hash for standard→deep eligibility; changes require fresh standard review.
- One live deep request per parent standard review/version; no blind repeat charging.
- Revalidate eligibility at quote, order, payment reconciliation and review completion.
- Membership price is snapshotted on accepted unexpired quote; expiry TTL is configurable
  and must be agreed before paid launch. No retroactive repricing settled orders.
- Material criteria in DEEP_REVIEW.md are a proposed implementation rubric requiring
  partner signoff, not a declaration of Indonesian law or legal approval.
- Paid review becoming ineligible goes to operations resolution, never silent issuance/refund.
Refunds, re-review rounds, SLA and negative-outcome legal wording require signed policy.

## Uploaded documents (Task 6) — keputusan pengendali, menunggu konfirmasi pemilik/mitra hukum
- Version hash for an uploaded document = SHA-256 of the frozen extracted canonical text (the exact text AI and
  reviewers read; used in QR, `/verify` and exports, which carry the note "Kode ini untuk teks hasil pembacaan,
  bukan berkas asli."). The SHA-256 of the exact original file bytes is stored separately (`document_uploads`)
  and shown to the owner with a distinct label. Keputusan pengendali, menunggu konfirmasi pemilik/mitra hukum.
- AI Verified is issued only for uploaded documents, not AI-assisted template documents (those still receive the
  pre-review report, without an AI Verified record). Enforced in the server handler. Keputusan pengendali, menunggu
  konfirmasi pemilik/mitra hukum.

## Review integrity (Task 12, audit B) — keputusan pengendali, menunggu konfirmasi pemilik/mitra hukum
- Verified label (SECURITY_AND_LEGAL "Mandatory copy", exact): "Dokumen versi ini telah diperiksa oleh profesional hukum sesuai
  ruang lingkup review yang tercantum. Tidak menjamin keabsahan atau hasil hukum tertentu." It is shown IN ADDITION to the
  VERIFICATION_POLICY statements (with notes / without notes / Enhanced) and the legal disclaimer, on every ACTIVE LEGAL and
  LEGAL_ENHANCED surface: owner result pages (`/reviews/[id]`, `/deep-reviews/[id]`), the owner document verification panel,
  public `/verify/[code]`, and the verification block of DOCX/PDF exports. It is not shown for AI records or for revoked or
  suspended records. Neither text replaces the other; both were mandated by current specs.
- UI never uses the word "cap": the checkout statement says "verifikasi Enhanced" where VERIFICATION_POLICY says
  "cap Enhanced" (owner instruction in plan BG; meaning unchanged).
- Work authorship: report text, Legal Notes, Deep note dispositions and M1–M7 checklist rows record the reviewer and the
  assignment that saved them. Only rows saved under the deciding reviewer's current assignment count at publish/decision;
  after reassignment the new reviewer must review and re-save (re-confirm) each item. Rows of a reviewer whose authority was
  revoked are never carried forward because the old assignment has ended.
- Conflict of interest: a reviewer can never be the document owner (checked at assignment and inside the issuing
  transaction). A firm coordinator can record a firm-level conflict with a document owner (`firm_conflicts`, append-only),
  which blocks assignment and issuance within that firm. Every Standard publish and Deep decision requires an explicit
  "tidak ada konflik kepentingan" statement by the reviewer, stored with the report (`no_conflict_attested_at`) and in the
  verification issuer snapshot. Clearing a firm conflict, rerouting to another firm and the refund path are not implemented
  and need partner policy.
- Deep eligibility also rejects when the parent document has an open Special Legal Case (`SPECIAL_CASE_OPEN`).
- `ENHANCED_ISSUANCE` is enforced twice: in the server handler/action and inside `decide_deep` (the server passes the flag value).

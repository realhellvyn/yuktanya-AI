# Deep Review — eligibility, notes, checklist, decision

## Eligibility invariant
`eligible = owner_authorized AND parent.type == STANDARD AND parent.status == COMPLETED
AND parent.report.published AND parent.legal_verification.active
AND count(parent.report.notes where actionable AND published) > 0
AND target.version_id == parent.version_id AND target.sha256 == parent.sha256
AND no_active_or_completed_deep_request_for_parent AND no_conflict_or_special_triage_block`.
For quote/new-order eligibility the duplicate check covers every existing live/completed
request. For reconciliation/finalization of an existing request, exclude that request itself
from the duplicate check; recheck remaining substantive guards against its fixed parent.
Without this distinction the valid paid request would incorrectly block its own completion.
Standard report remains immutable; note resolution is recorded in the deep report, not
by editing the parent notes. Informational-only notes do not qualify. AI notes do not qualify.
No offer on draft, pending, failed, inconclusive or no-note standard work. No direct URL/API
bypass. Declining deep work does not erase standard results or restrict normal downloads.
Closed/cancelled request reopening and repeat paid deep work require agreed policy.

## Price and order
Additional to already-paid Standard Review: Free Rp200.000; active Member Rp150.000.
Membership Rp19.000 is separate. No first-standard discount applied to deep work.
Illustrations: Free standard+deep Rp250.000; active Member first standard+deep Rp180.000,
later standard+deep Rp185.000 (membership fee excluded from these service totals).
If user also buys membership, explicitly show the extra Rp19.000; never hide it.
Server quote binds owner, STANDARD parent, target version/hash, plan/period snapshot,
price/currency, policy version and expires_at. Resolve active membership on quote creation;
if accepted before expiry, honor quoted price; expired quote is repriced with explicit consent.
Revalidate eligibility inside order transaction. Unique live request/order protects double click.
Use verified settlement, not browser success or uploaded screenshot. Duplicate callbacks
must not create duplicate tasks, revenue, notes, approval or verification.

## Workflow and exceptional states
`ELIGIBLE → QUOTED → AWAITING_PAYMENT → QUEUED → IN_REVIEW → READY_FOR_DECISION
→ COMPLETED` with completion outcome separate from status.
Alternatives: QUOTE_EXPIRED, CANCELLED, ON_HOLD, INCONCLUSIVE, REFERRED_SPECIAL_CASE.
Payment states are separate: PENDING, VERIFIED, FAILED, EXPIRED, REFUNDED, DISPUTED.
Only VERIFIED can queue paid work. A late settlement after cancellation/expiry or changed
eligibility creates PAYMENT_RECONCILIATION_REQUIRED, no automatic reactivation or cap.
Assignment requires valid authority/capacity/conflict check. Reviewer can save checklist
draft; submit locks report revision. Final approval is an explicit authorized professional
action (same assigned qualified reviewer may act if policy permits; second approver is
optional partner configuration, not an invented universal requirement).

Any submitted version change requires fresh standard review of that new version. Existing
paid deep request stays bound to old version; user must explicitly choose whether to
continue on old version under engagement or seek support. Never transfer payment/badges.
If facts/clauses must change to resolve material issues, create new version, do not issue
Enhanced for old bytes. Refund/credit/re-review policy unresolved: manual audited resolution.

## Legal Note editor — structured and version-bound
Fields: note_id, review/report revision, anchor (page/clause/range + fallback text location),
title, plain-language finding, severity INFO/MINOR/MATERIAL/CRITICAL, actionable boolean,
recommended action, required evidence, scope reference, author, timestamps.
Actionable requires nonempty action; material/critical requires rationale and escalation.
Legal sources only when checked; no invented citation. Include `Tanpa Legal Note` explicit
reviewer declaration; reject zero-note WITH_NOTES and outstanding-note WITHIN_SCOPE.
Draft save uses optimistic revision/ETag to prevent lost edits. Persisted saves alone show
`Tersimpan`; unsaved leave warning, retry-safe submit, field-level errors.
Preview user-visible report before publish. Private professional working notes are separate
and excluded from customer/public projections. Final notes append-only via new revisions.

## Proposed material rubric — partner approval required before enabling Enhanced
Each assessment stores PASS/FAIL/UNKNOWN/N_A, reasoning, evidence references, author,
assessment time, policy version. Evidence is private and access-controlled.
| ID | Required check | Pass evidence |
|---|---|---|
| M1 | Parties, capacity and authority within agreed verification scope | Relevant identity/authority evidence assessed; unverified facts disclosed; unresolved material capacity blocks |
| M2 | Agreement terms and essential obligations sufficiently clear and consistent | Clause-by-clause obligations, object, price/time/termination where applicable |
| M3 | No identified material illegality/prohibited purpose within reviewed scope | Professional reasoning and checked sources where relied upon |
| M4 | Material risks/contradictions from Standard Legal Notes addressed | Note-by-note resolution with source/evidence, no unresolved MATERIAL/CRITICAL |
| M5 | Required formalities or special professional acts assessed | Requirements completed when required for conclusion, or explicitly outside scope with no misleading claim; unmet material requirement blocks |
| M6 | Extra work complete and evidence sufficient for conclusion | Additional checks recorded, no unknown material question hidden |
| M7 | Exact artifact, authority, conflict, scope and user disclosures confirmed | Hash match, active assignment/credentials and engagement, explicit reviewer attestation |

M4/M6/M7 mandatory, cannot N/A. Others may N/A only if policy permits and reason approved;
mandatory applicability decisions cannot be delegated to AI. Partner must define document-
specific evidence thresholds; until signed, Enhanced cannot be issued (`decide_deep` rejects
an unapproved rubric). Owner decision 17 Oct 2026: the ENHANCED_ISSUANCE and
DEEP_REVIEW_PURCHASE flags are ON in production; the rubric gate above still applies.
No unresolved material or critical notes; a MINOR/INFO limitation may remain only if rubric
permits, disclosed in enhanced report and not represented as zero remaining notes.

## Final approval guard
Recheck role/firm/assignment/credential validity, payment, parent active, eligibility snapshot,
version/hash, signed rubric, checklist completeness, note dispositions, no material blockers,
explicit human attestation and final decision inside trusted transaction. AI may draft a
suggestion but cannot check PASS, publish approval or issue record. Admin payment authority
cannot substitute professional approval. If any guard fails, no Enhanced record.
Store APPROVE/DENY/INCONCLUSIVE/REFER_SPECIAL decision with reason and reviewer identity.
User receives report even if Enhanced not granted, per engagement. A declined cap is not
automatically a refund event; policy must be agreed before real paid rollout.

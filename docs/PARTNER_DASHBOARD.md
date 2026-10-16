# Legal Partner / Reviewer Dashboard — required v8 surface

Entry `/partner`; reviewer sees assigned work only. Coordinator sees own firm queue and
assignment controls; no platform revenue or cross-firm records. Professional authority and
coordinator permission are separate. If person also has reviewer role, issuance still checks
their own assignment/credentials, never the coordinator label alone.

## Screens
- `/partner`: assigned standard/deep queues, aging and agreed SLA, conflicts, needs-info,
  pending checklist/decisions. Distinguish queue volumes from finalized legal outcomes.
- `/partner/reviews/[id]`: secure immutable file/version/hash; scope and engagement; AI
  analysis labeled informational; conflict/credentials state; structured Legal Note editor;
  autosave/report preview; request revision; Standard completion WITH_NOTES/WITHIN_SCOPE.
- `/partner/deep-reviews/[id]`: parent standard report, actionable notes and exact target;
  note resolution table; evidence links; M1–M7 checklist with rationale; extra-work log;
  user-visible limitations; decision preview; explicit `Selesaikan pemeriksaan tambahan`.
- `/partner/approvals`: assigned authorized final decisions, never a payment-to-approve button.
- `/partner/cases`: special-case triage/custom quote/engagement unchanged.
- `/partner/team`: coordinator-only firm assignment and availability, no platform role grants.

## Layout
Desktop queue left, secure document center, notes/checklist panel right; responsive tabs on
mobile `Dokumen`, `Catatan`, `Pemeriksaan`, `Hasil`. Page title always includes review type.
Read-only version/hash indicator. Text/icon statuses; keyboard-operable evidence uploader,
clause anchors with textual fallback, large controls, autosave failures announced.
Final modal names exact version, outcome, unresolved notes and scope; requires human
confirmation. Disabled approval explains missing requirement, not just gray button.

## Revise/reassign
Reassignment revokes old reviewer write/read access promptly and stops stale signed URL
renewal. Short-lived preissued URLs remain bounded by expiry; for immediate revocation
requirements use authorization proxy, not a promise that signed URLs instantly vanish.
Optimistic report revision guards stale tabs. Never edit finalized reports or reviewed bytes.
Revision creates new document version, no inherited result; route through standard policy.

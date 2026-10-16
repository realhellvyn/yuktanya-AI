# E2E implementation catalogue — run selectively

Not executable until application and fixtures exist. Tag implementations `@auth`, `@standard`,
`@deep`, `@billing`, `@verification`, `@roles`, `@quota`, `@release-smoke`. No auto-run-all on
every change; TEST_STRATEGY.md controls selection. Assert backend state, not just UI toast.

| ID / tag | Setup and action | Required assertions |
|---|---|---|
| E01 auth | Anonymous opens AI entry/direct API | Register/login before AI; API denies; gateway not called |
| E02 roles | User/reviewer tries admin; unassigned/cross-firm reviewer tries case | 403/denied DB and file access; no metadata leak |
| E03 standard | Settled Free standard Rp50k; assigned professional publishes completed report without notes | LEGAL WITHIN_SCOPE for exact frozen hash, no Enhanced; no deep offer |
| E04 standard/deep | Completed standard with actionable MATERIAL note | LEGAL WITH_NOTES, visible severity/action; deep offer available |
| E05 deep | Open deep URL/API from pending standard, no-note report, AI-only notes or revoked parent | No quote/order/task created; accessible ineligibility reason |
| E06 billing | Free eligible checkout; active Member eligible checkout | Additional Rp200k/Rp150k; previous standard charge displayed separately; membership not bundled |
| E07 billing | Member first and later standard; concurrent first-discount orders | Rp30k/Rp35k; only one reserved-or-consumed first entitlement; failed order release |
| E08 billing | Fake payment redirect/screenshot, duplicate verified callback | No queue before trusted settlement; exactly one payment/revenue/task after valid repeated callback |
| E09 deep | Paid case, authorized reviewer extra work, M1–M7 pass + evidence, explicit APPROVE | One LEGAL_ENHANCED, correct parent/version/hash/report/audit and QR; payment alone issued none |
| E10 deep | Same payment but required criterion FAIL/UNKNOWN, material note unresolved or no attestation | Completion/report allowed per outcome; zero Enhanced; clear reason, no guaranteed-positive copy |
| E11 deep/roles | Role revoked, stale assignment/tab, missing credentials, admin attempts approval | No legal issuance; reauth/assignment check; safe audit |
| E12 verification | Edit document/reexport, replay stale completion | New version no inherited badge; old record still old hash; derivative export hash distinct |
| E13 verification | Scan QR then revoke; invalid code; parent revoked with Enhanced dependency | Safe current active/revoked/not-found response; no private content; dependent Enhanced not active |
| E14 quota | Free 20/1/2; Member 60/5/10 boundaries and exhausted message with remaining AI reviews | Limits enforced; each successful review +1 message; no review when either counter exhausted |
| E15 quota | Gateway failure, retry, parallel calls, WIB midnight, upgrade/expiry midday | Dual counters released/deduped; no overspend; correct ceilings/reset; existing docs accessible |
| E16 deep/billing | Quote expires/membership changes; new version or parent revoked before settlement | Expired quote requires explicit new quote; accepted valid price honored; invalid paid flow held for reconciliation |
| E17 admin | Seed standard/deep orders, failures/refunds, delayed completions | Verified-payment-only revenue split; unique funnel counts and fixed cohort denominator; honest no-data |
| E18 UI | Keyboard/mobile/200% zoom, notes comprehension, negative Enhanced outcome | Readable price/status/action; no color-only state; payment understood as review fee, not cap purchase |

Release smoke selects E01–E06, E08–E14 and affected exception paths. Full matrix before major
release; unit/integration cover detailed permutations without unnecessary browser repetition.

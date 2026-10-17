# Testing policy — risk-based, explicit owner instruction

Do NOT execute E2E after every change, screen, document, component or generated artifact.
Keep scenarios ready; choose minimum meaningful checks for actual impact.

| Change | Normal verification | When to add E2E |
|---|---|---|
| Copy/docs/spacing/color | Review edited output; focused visual/accessibility inspection where relevant | Only if critical behavior/navigation changed |
| Pure business logic | Targeted unit tests, boundary vectors | If integrated user journey changes |
| DB/RLS/quota/payment/issuance | Targeted integration, negative authorization and concurrency checks | Selected impacted critical journey |
| Auth, checkout, standard/deep completion, QR/revocation | Relevant unit/integration plus selected journey E2E | On material workflow changes |
| Pilot/public release | Build/typecheck plus security/privacy gates and critical smoke | Auth, payment, standard, deep approval/denial, lookup/revoke, quotas and access smoke |

Full regression only before major release or when shared infrastructure changes warrant it.
Do not rerun passing suites just to report more checks. Do not block harmless edits on whole
application E2E. Test new failures/corrections with targeted reruns. Existing launch gates
remain; this policy reduces repetitive work, not server authorization requirements.

## Layers
Unit: eligibility, pricing snapshots, note validators, rubric decision, WIB buckets.
Integration: transaction atomicity, RLS/Storage, webhook reconciliation/dedup, reservations,
hash-bound issuance, outbox retry and revocation dependency; synthetic files only.
E2E: scenario catalogue in tests/e2e/SCENARIOS.md; implement in Playwright against mocked AI
and payment adapters/test Supabase, not real paid transactions or confidential documents.
Use isolated accounts user/reviewer/coordinator/admin and no shared mutable fixtures.
Production-mode E2E (`npm run test:e2e:prod`, E17e): `next build` + `next start` with the same fake env (all three feature
flags on, as in production since 17 Oct 2026; default journeys `journey-ux`, `journey-prod-ai` upload + AI review + bronze
medal + `/verify`, and `journey-roles` Legal Review → silver → Deep Review offer → gold), production React,
minified Turbopack chunks and the production nonce CSP. Run it before every release/deploy promotion and after changes to
client components, server-action forms (`useActionState`, `useFormStatus`, actions passed as props) or `src/proxy.ts`;
not after every change. Plain E2E uses `next dev` and missed a production-only crash (Task 17). Every browser context
emulates current Chrome (149/150+), where `scrollIntoView`/`scrollTo`/`scrollBy`/`scroll` return a Promise
(`E2E_SCROLL_PROMISE=0` turns this off). ESLint forbids expression-bodied `useEffect`/`useLayoutEffect` arrows.
Accessibility: focused keyboard/zoom/axe and human comprehension, per impacted screen;
320/375/390 and 1280 layouts before UI release, not all viewports after every tiny edit.

## Report honestly
Record selected checks, result and reason for scope; skipped E2E with simple impact reason.
This package contains test SPECIFICATIONS and policy vectors, not runnable application E2E.
Do not call scenario presence or blueprint validation an application test pass.

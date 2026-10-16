# Detailed User Journeys and Interaction Rules

## Persona A: older adult / first-time smartphone user
Goal: create a simple loan agreement.
1. Arrives via link, reads `Buat dokumen hukum lebih mudah`.
2. Taps `Daftar Gratis`, registers, verifies email if required. Provide plain-language explanation if email verification blocks progress.
3. Sees 3 document choices, taps `Surat Utang Piutang`.
4. One question at a time, examples: `Contoh: Rp5.000.000`, simple explanations of legal terms.
5. Can go Back, edit, save progress, resume later. Show visible progress and autosave confirmation.
6. Reviews a human-readable summary of supplied facts **before** generating the draft.
7. Previews, downloads, or requests optional paid lawyer review.
8. If payment chosen, clear total, who reviews, and what happens next.

## Persona B: freelancer
Goal: PKS with client. Registers, chooses PKS, completes interview, edits scope, exports DOCX. No payment required.

## Persona C: member
Goal: request second review in same billing period. Membership card accurately shows first-review benefit already used and **Rp35.000** next standard review. No accidental Rp30.000 quote.

## Persona D: complex/high-risk case
User uploads complex agreement. AI triage flags risk; standard checkout disabled; clear message `Dokumen ini memerlukan penilaian khusus`; collect consent; law firm conflict check, custom quote, explicit acceptance.

## Persona E: reviewer
Receives assigned case, reads frozen version, records findings, requests revisions or completes review. Only after authorized human completion can Legal Verified be issued; AI Verified has its own preliminary-analysis flow.

## Persona F: admin
Opens `/admin`, sees funnel drop-off, AI errors, overdue review queue, settled payments; can diagnose operations without reading private contract content.

## Interaction principles for low digital literacy
- One major task per screen, one primary button, no jargon without explanation.
- Ask 1 logical question per step, with examples and input masks for IDR/dates; **do not force chat-only entry**.
- Avoid 15-question walls; progressive disclosure.
- `Kembali` never deletes answers; save on Next and autosave on pause.
- Explain status in natural language and tell user the next action.
- Show recoverable errors inline; never lose filled answers on gateway failure.
- Confirm irreversible and paid actions.
- Make help discoverable and human contact options explicit if available.
- Use plain Indonesian `Periksa oleh pengacara` rather than `human review` in consumer UI.
- Use terms `AI` and `pengacara` distinctly, including verification.
- Test comprehension, not only click completion.

## Failure paths
- Signup email not received: resend and guidance.
- Session expired: re-login, preserve local draft safely where feasible.
- Network offline: inform user, do not claim saved until persisted.
- AI timeout: retry without duplicating document/payment, preserve inputs.
- Invalid field: explain exact correction with example.
- Unsupported document: route to special-case assessment, not fake generated contract.
- Payment pending: clear verification process, never mark paid from screenshot alone.
- Reviewer needs revisions: clear what to change and how to resubmit.
- Verification code invalid/revoked: honest status, support channel.

## Content guidelines
Prefer `Buat Dokumen`, `Periksa Dokumen`, `Simpan`, `Unduh`, `Lanjut`, `Kembali`, `Bantuan`.
Avoid unexplained `prompt`, `token`, `RAG`, `LLM`, `SLA`, `NDA` (spell out first time), `submit`, `deploy`.
Use short sentences, active voice, no alarmist copy or unsupported legal guarantees.

## v8 — additional journeys
With actionable Standard Legal Note: read notes → understand proposed extra scope → see
additional price by active plan → optional paid Deep Review → wait for professional extra
review → receive report; Enhanced only if criteria approved. Payment-not-guarantee is shown
before acceptance and on result. User declining deep keeps Standard Legal Verified/report.
Without Legal Note: Standard Legal Verified with scope, no deep offer, no forced upsell.
Unresolved material criterion after deep: explain remaining issue/action or special-case
referral, show report, no Enhanced despite payment. Edited version: explicitly new/unreviewed.
Reviewer drafts Legal Notes, publishes complete standard; authorized deep assignee resolves
notes, checks evidence/rubric and explicitly decides. Admin reconciles fees and bottlenecks,
cannot change professional conclusion to improve conversion.

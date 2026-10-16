# Usability Validation — Before Public Launch

## Test with real target users
Recruit at least **8–12 participants** for initial moderated sessions, including **4–6 older/low-digital-literacy users**, a mix of Android screen sizes and first-time legal document users. Treat this as an initial practical target, not statistically representative proof.

## Tasks (no coaching during task)
1. Create account and find where to make a free document.
2. Start an Utang Piutang document and enter an amount and due date.
3. Correct a previous answer without losing work.
4. Save and reopen a draft.
5. Explain difference between AI draft and lawyer-reviewed document.
6. Find the actual standard review price as free user vs member.
7. Find the status of a submitted review.
8. Locate help when AI is unavailable.

## Record
Task success without assistance, misclicks, completion time, where confusion occurs, errors, subjective ease (single question), readability feedback, whether user understands payment and AI limitations.

## Initial release criteria (targets, refine after pilot)
- >= 90% participants complete account + start-document tasks unaided.
- >= 80% complete first simple draft unaided with sample data.
- 100% participants shown correct price before payment.
- 100% users can tell AI draft from human-reviewed status after viewing explanation.
- No critical accessibility blockers, cross-user leaks, or payment confusion.
- Re-test after fixing top 5 usability blockers.

## Automated checks
Playwright E2E mobile viewport 320/375/390 and desktop 1280; axe-core accessibility scan; keyboard tab/focus tests; 200% browser zoom; offline and 429/timeout states; visual regression snapshots for critical pages.

## Human QA
Ask testers to read aloud button labels, identify next step without hints, and describe what `Verified` means. If misunderstood, rewrite copy; don't add a tooltip as the only fix.

## v8 — additional comprehension tasks and execution scope
Ask users to distinguish standard with/without notes, locate required action, explain why
deep is offered only after actionable notes, read extra Rp200k/Rp150k separately from
standard fee, and explain that payment does not guarantee Enhanced or legal validity.
Include negative deep outcome, older-version and revoked QR examples; no misleading cap.
Run moderated sessions before pilot/public launch and after material confusion changes.
The automated checks above describe coverage, not an instruction to run every viewport/E2E
after each change. TEST_STRATEGY.md overrides any inferred per-change E2E requirement.

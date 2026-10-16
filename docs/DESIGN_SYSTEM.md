# Yuktanya UI Design System v1 — Implementation Contract

## Goal and audience
A calm, trustworthy Indonesian legal service usable by first-time smartphone users, including older adults with low digital literacy. **Clarity beats novelty.** All user-facing language in plain Bahasa Indonesia. Mobile-first; desktop supports richer document workspace.

## Visual direction
- Professional, reassuring, uncluttered; **not** a playful AI chatbot aesthetic.
- Brand palette proposal (adjust only with explicit approval): navy `#17324D`, blue `#2563EB`, off-white `#F8FAFC`, white `#FFFFFF`, ink `#17212B`, muted `#475569`, success `#166534`, danger `#B91C1C`, border `#CBD5E1`. Verify contrast on actual components. Do not communicate state using color alone.
- Use one readable UI font (e.g. Inter or system sans) and avoid thin weights. Avoid loading remote fonts as a critical dependency.
- Default body **16–18px**, major labels 16px+, main page headings 26–32px mobile, 32–40px desktop. Minimum 14px only for noncritical secondary text; legal instructions never tiny.
- Line height 1.5–1.7, sentence case, generous whitespace.
- Tap/click target **at least 44×44 CSS px**, preferably 48px on mobile. Buttons min-height 48px, primary actions 52px. Gap between adjacent destructive/primary controls.
- Visible focus indicators, keyboard navigability, text scaling to 200%, reduced-motion support.
- Spacing tokens: 4/8/12/16/24/32/48; border radius 8–12px; avoid excessive shadows.
- Maximum reading width ~720px for long forms, 1100–1280px for dashboards.
- Use Lucide icons only with text labels for key navigation. Never icon-only critical actions.

## Layout
Mobile (320–767px): one column, 16px horizontal padding, top app bar; 4–5-item bottom navigation if needed; one clear primary CTA per screen. Do not display side-by-side chat and document.
Tablet (768–1023px): content centered, navigation adapted.
Desktop (1024px+): left sidebar 240–260px, main content; workspace chat/preview split approx 42/58 with user-adjustable width only if simple.

## Shared components
`AppShell`, `TopBar`, `SideNav`, `BottomNav`, `PageHeading`, `PrimaryButton`, `SecondaryButton`, `StatusBadge` (text+icon), `StepIndicator`, `FieldGroup`, `HelpText`, `InlineError`, `ConfirmDialog`, `Toast`, `EmptyState`, `LoadingSkeleton`, `FileUpload`, `DocumentCard`, `PriceBreakdown`, `ReviewTimeline`, `SupportEntry`, `AccessibleTabs`.
- Each form field: visible label, example, optional explanation, validation near field, no placeholder-only labels.
- Required fields marked “Wajib”; optional fields marked “Opsional”.
- Confirmation before irreversible actions (delete, submit paid review, send to professional).
- Success states must state what happened and next step.
- Destructive actions are not adjacent to primary actions.
- Use explicit dates `16 Oktober 2026`, prices `Rp50.000`, avoid abbreviations (e.g. explain PKS and NDA).

## Status language
- `Draft AI — Belum diperiksa pengacara`
- `Menunggu pembayaran`
- `Menunggu pemeriksaan`
- `Sedang diperiksa`
- `Perlu perbaikan`
- `Selesai diperiksa`
- `Yuktanya Legal Verified — versi ini telah diperiksa profesional` with scope disclaimer
- `Kasus khusus — perlu penawaran`

## Accessibility checklist
WCAG 2.2 AA target where practical; contrast >=4.5:1 for normal text; clear labels and error association; keyboard focus; screen-reader announcements for progress; no time-limited forms without warning; support browser zoom; do not depend on drag-and-drop; plain-text file picker alternative.

## Explicit anti-patterns
No tiny gray text, auto-opening chatbot popups, unexplained jargon, confusing dual primary buttons, hidden costs, paywalls for free AI, long unbroken forms, misleading “100% sah” claims, AI verification without successful persisted analysis, dark patterns, dense analytics on user dashboard, or required voice interaction.

## Implementation note
Use Tailwind CSS tokens and shadcn/ui primitives, but adapt defaults to this design system. Create Storybook only if it does not block MVP; a `/design-preview` development-only route with all components is sufficient.

## v8 — status and result components
Add LegalNoteCard (severity + action + location), DeepEligibilityNotice, ExtraReviewPrice,
ChecklistAssessment, ProfessionalDecisionSummary and QRVerificationPanel with text URL/code.
AI uses neutral/blue informational process icon, Legal distinct professional review icon,
Enhanced distinct labeled legal treatment; never present it as official/government seal.
Always render `Dengan Legal Note`, `Tanpa Legal Note`, `Enhanced`, `Dicabut` or `Versi lama`
as text, not color alone. Scope/limitations and payment-not-positive-outcome copy are body
size, not footnotes/tooltips. Existing typography/tap targets/mobile/zoom rules apply.
Use `Pemeriksaan mendalam (tambahan)` and explain Legal Note as `Catatan dari pemeriksa`.
Loading/save states announced politely; failure must not say saved or completed.

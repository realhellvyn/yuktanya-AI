# Yuktanya UI Design System v1 — Implementation Contract

## Goal and audience
A calm, trustworthy Indonesian legal service usable by first-time smartphone users, including older adults with low digital literacy. **Clarity beats novelty.** All user-facing language in plain Bahasa Indonesia. Mobile-first; desktop supports richer document workspace.

## Visual direction
- Professional, reassuring, uncluttered; **not** a playful AI chatbot aesthetic.
- Brand palette: **approved Yuktanya brand kit (navy · gold · cream), light theme only** — see "Brand kit (Task 18)" below. The earlier proposal (navy `#17324D`, blue `#2563EB`, off-white `#F8FAFC`, border `#CBD5E1`) is superseded. Verify contrast on actual components. Do not communicate state using color alone.
- One readable UI font: **Plus Jakarta Sans** (self-hosted, see below); avoid thin weights. Never load remote fonts (CSP `font-src 'self'`).
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

## Brand kit (Task 18) — implemented tokens
Owner-approved brand kit "Yuktanya" (tokens.json + README of the kit). **Light theme only** for now; no dark theme.
Source of truth in code: `:root` + `@theme inline` in `src/app/globals.css`; contrast pairs are enforced by
`tests/unit/brand-tokens.test.ts`.

| Role token | Value | Tailwind class | Use |
|---|---|---|---|
| `bg` | cream `#F8F5EC` | `bg-canvas` | page background |
| `surface` | `#FFFFFF` | `bg-surface` | cards, inputs, panels |
| `ink` | charcoal `#1A1A1A` | `text-ink` | body text (16:1 on cream) |
| `heading` / `navy` | `#0D1B2A` | `text-heading`, `text-navy` | headings, wordmark |
| `muted` | `#5B5A55` | `text-muted` | secondary text (6.3:1 on cream) |
| `primary` / `primary-hover` / `on-primary` | `#0D1B2A` / `#1F3550` / `#FFFFFF` | `bg-primary`, `hover:bg-primary-hover`, `text-on-primary` | primary button |
| `link` | `#0D1B2A` | `text-link` + `underline` | links are always underlined |
| `gold-ink` | `#8A6420` | `text-gold-ink` | the only gold shade allowed for text on light backgrounds |
| `line` | `#E4DDCD` | `border-line` | decorative dividers, card borders |
| `border-strong` | `#7A7468` | `border-border-strong` | input and secondary-button borders (≥3:1) |
| `focus` | `#8A6420` | global `:focus-visible` outline | 3px solid ring, offset 2px |
| `tint` / `subtle` | `#F4EBDA` / `#F2EEE4` | `bg-tint`, `bg-subtle` | warm highlight (active menu, user chat bubble, suggestion card) / neutral hover and notes |
| `success`, `danger` | `#166534`, `#B91C1C` | `text-success`, `text-danger` | status, always with words + icon |

- **Gold `#D4A66A` is never text, meaningful icon or button fill on a light background** (2.04:1 on cream). It is only
  for the logo and accents on navy (7.8:1), e.g. the step numerals on the home page (`bg-navy text-gold`). Tested rule: a
  class string containing a `*-gold` colour class must also contain `bg-navy`.
- Warning `amber-*` and green/red status boxes stay as they are (meaning of status); their contrast on cream is tested.
- No Tailwind `slate/gray/blue/...` palette classes in `src/**` (warm neutrals only; tested).
- Typography: **Plus Jakarta Sans** (variable, `@fontsource-variable/plus-jakarta-sans`) for all text, body stays 17px;
  **Source Serif 4 700** (`@fontsource/source-serif-4`, latin subset) only for the wordmark "Yuktanya"
  (`src/components/brand-logo.tsx`). Both are SIL Open Font License 1.1 (OFL-1.1; licence text ships in each npm package
  under `node_modules/.../LICENSE`). They are imported as CSS in `src/app/layout.tsx`, bundled by Next.js and served
  from our own origin (`/_next/static/media`), so `next build` works offline and CSP `font-src 'self'` holds.
- Logo: final SVGs copied unchanged from the brand kit into `public/brand/` (`yuktanya-mark-{navy,gold,white}.svg`,
  `yuktanya-mark-small-{navy,gold}.svg`, `yuktanya-app-icon.svg`). Headers (public, user, partner, admin, auth, 404)
  use `BrandLogo`: small navy mark 32px (`alt=""`) + serif wordmark. `src/app/icon.svg` = app icon;
  `src/app/apple-icon.png` (180×180) and `src/app/opengraph-image.png` (1200×630) are rendered once by
  `node scripts/brand/render-icons.mjs` and committed. Exported DOCX/PDF documents carry no logo (not in Task 18).
- Verification badge: replaced in Task 20 by the tiered medal below (`VerificationSeal` removed).

## Verification medals (Task 20) — owner decision 17 Oct 2026
Design and text come from the legal partner brief, approved by the owner (see DECISIONS_AND_PRECEDENCE.md, Task 20).
This supersedes the brand-kit rule "the badge must not use a shield, gold or the logo mark". The medal only visualises
verification records that already exist; it never creates a tier or an issuance rule.

| Tier | Record shown (server status) | Medal text (main / small) | Ring · edge · face | Shape |
|---|---|---|---|---|
| bronze | `AI` ACTIVE (AI Verified, uploaded documents only) | AI Verified / Pemeriksaan Awal oleh AI | `#A86B3C` · `#7A4A26` · `#F0D2B4` | single ring |
| silver | `LEGAL` ACTIVE, outcome WITH_NOTES / WITHIN_SCOPE | Legal Verified / Legal Review · Dengan Catatan, or Legal Review · Sesuai Lingkup | `#C7CCD3` · `#6B7480` · `#EEF0F3` | single ring |
| gold | `LEGAL_ENHANCED` ACTIVE, outcome ENHANCED_APPROVED | Legal Verified Enhanced / Pemeriksaan lanjutan profesional | `#D4A66A` · `#8A6420` · `#F6E3BF` | double ring |

- Component: `VerificationMedal` (`src/components/verification/verification-medal.tsx`, prop `tier`, optional `note`,
  `size` `sm` 32px / `md` 56px / `lg` 80px). The tier is always chosen with `medalFor(kind, status, outcome)`
  (`src/lib/verification/medal.ts`); REVOKED/SUSPENDED and badge-less outcomes return no medal and the existing status
  text stays. Static copies with text: `public/brand/medals/medal-{bronze,silver,gold}.svg` (documentation only; kept
  identical to the component by `tests/unit/verification-medal.test.tsx`, regenerate with `UPDATE_MEDALS=1`).
- Graphic: flat SVG, three tones per metal (no gradients), outer ring + inner face + the brand-kit small mark in navy
  (path copied verbatim from `public/brand/yuktanya-mark-small-navy.svg`, not redrawn). `aria-hidden`; the text under the
  medal is real text read by screen readers. Text uses `heading` (main) and `muted` (small), ≥4.5:1 on `bg`/`surface`.
- Contrast (tested): edge vs `bg` / `surface` — bronze 6.79 / 7.41, silver 4.34 / 4.74, gold 4.91 / 5.35 (all ≥3:1);
  navy mark vs face ≥12:1. Gold `#D4A66A` is used only as the ring fill of this graphic with the dark `#8A6420` edge
  (the single exemption in `tests/unit/brand-tokens.test.ts`); it is still never text, an icon or a button fill.
- Where it appears: document verification panel (`VerificationPanel`), owner AI report for uploaded documents
  (`AiReviewResult`, only when an active AI Verified record exists), Legal Review result (`ResultPanel`), Deep Review
  result (`DeepResult`), public `/verify` (`PublicVerification`, active only), admin verification list (32px). AI reports
  of template documents never show a medal (they have no AI Verified record). DOCX/PDF exports keep the official title
  text without the medal graphic.
- Prohibited: a medal without its ring or text; using the medal as a logo, header mark, favicon, decoration or marketing
  illustration; bronze text containing "Legal", "Sah" or "Terjamin"; showing a medal for a revoked/suspended record;
  rendering gold without an active Enhanced record; implying a notarial, government or official seal.

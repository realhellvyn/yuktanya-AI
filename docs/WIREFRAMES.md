# Screen-by-Screen Wireframes (Textual, Implementation-Ready)

All screens must have **mobile and desktop** variants. Follow `DESIGN_SYSTEM.md`. Below, content order is the actual visual hierarchy.

## 1. Public landing `/`
Mobile: [Logo][Masuk] → headline `Buat dokumen hukum lebih mudah` → 2-line explanation → primary `Daftar Gratis` → secondary `Lihat Cara Kerja` → 3 document examples → 3-step how it works → transparent price comparison → trust/limitations → FAQ → footer.
Desktop: same content, hero in 2 columns with illustrative *nonfunctional* workspace preview.
AI teaser prompt may appear but on submit **redirects to login/register** and saves intent, never calls AI anonymously.

## 2. Register `/register`
Title `Buat akun Yuktanya`; Google button if configured; divider `atau`; email, password, show/hide password; readable password guidance; consent links; primary `Daftar Gratis`; link `Sudah punya akun? Masuk`. Verification email state with resend and troubleshooting. No legal jargon.

## 3. Login `/login`
Email, password, `Lupa kata sandi?`, `Masuk`, Google option, link to registration. Display clear errors without exposing account existence. Return to intended protected page.

## 4. User dashboard `/dashboard`
Header → greeting → prominent `Buat Dokumen Baru (Gratis)` → `Periksa Dokumen Saya` → recent draft or empty state → review status if present → membership status → help. No graphs.

## 5. Choose document `/workspace/new`
Title `Dokumen apa yang ingin Anda buat?` → 3 large cards with plain descriptions → `Saya belum tahu` conversational intent selection. Explain estimated steps, not unverified time promises.

## 6. Interview `/workspace/[id]`
Mobile: title + `Langkah 2 dari 6` + question in plain language + field/example + `Mengapa informasi ini diperlukan?` expandable + buttons `Kembali` / `Lanjut` + persistent `Lihat Draft` tab.
Desktop: left question/chat panel, right document preview; draft updates after validated input, not after every keystroke.
AI can clarify but must never skip required validated fields. Show `Tersimpan` when persisted.

## 7. Preview/editor
Title + status `Draft AI — Belum diperiksa pengacara` → document body in readable width → `Ubah Jawaban` → `Simpan` → `Unduh DOCX/PDF` → optional `Minta Pemeriksaan Pengacara`. If preview incomplete, show missing fields and link back.

## 8. Upload `/documents/upload`
Title `Periksa dokumen yang sudah Anda punya` → accepted formats/sizes → file picker → privacy disclosure and explicit AI-provider consent → `Mulai Analisis Awal` (enabled only after quota enforcement and upstream privacy/security approval; otherwise show `Fitur sedang disiapkan`) → results grouped `Hal yang perlu diperhatikan`, `Informasi yang belum jelas`, `Saran pertanyaan untuk pengacara`. Avoid legal certainty.

## 9. Human review checkout
Frozen version summary + scope + standard/special eligibility + price breakdown with membership rule + expected next step and SLA only if confirmed + payment method → confirmation → payment pending → verified payment → queued review.
Show `AI gratis; pemeriksaan pengacara berbayar`. No prechecked membership upsell.

## 10. Review status `/reviews/[id]`
Simple vertical timeline `Diajukan` → `Pembayaran dikonfirmasi` → `Dalam antrean` → `Sedang diperiksa` → `Selesai` with exact dates. If revisions required, show single actionable CTA. On completion show report, scope, reviewer and verified version if issued.

## 11. Legal Vault `/vault`
Search + filter by type/status + cards with document title, updated date, status and actions `Buka`, `Unduh`, `Riwayat versi`. No document text preview visible by default in shared spaces.

## 12. Membership `/membership`
Current status, billing dates, first-review discount availability, transparent pricing, purchase/renew action. Clarify standard vs special-case exclusions.

## 13. Verification `/verify/[code]`
`Verifikasi pemeriksaan dokumen` → result `Ditemukan` / `Tidak ditemukan` / `Dicabut` → verification ID, document hash/partial safe display, date, reviewer/firm with appropriate consent, scope summary, disclaimer. **No public document contents.**

## 14. Partner `/partner/*`
Review queue with status, age, assignment; detail page with secure file viewer, checklist, findings, report upload, revision request, completion action requiring confirmation. No self-issued verified record outside authorized flow.

## 15. Admin `/admin/*`
Top KPI row, date filter, trend chart, conversion funnel, AI error alerts, review backlog, revenue reconciliation. See `ADMIN_DASHBOARD.md`. Admin pages are **not** consumer UX.

## Responsive acceptance
At 320px no horizontal scroll; at 375px buttons remain readable; at 200% zoom no clipped controls; at desktop chat+preview split; at mobile switch tabs without losing typed data; all steps usable by keyboard and screen reader.

## v8 — additional screen hierarchy
User standard result: [type/status/date] → [reviewed version + scope] → [Legal Verified result]
→ [Legal Notes with severity/action or explicit no notes] → [report download + QR/code]
→ [eligible optional deep offer with additional price and disclaimer].
Deep checkout: [why eligible/parent] → [extra work scope] → [standard already paid]
→ [additional amount due + plan snapshot] → [possible outcomes/no guaranteed cap]
→ [explicit payment confirmation]. No recurring purchase/prechecked membership.
Partner standard: [assignment/authority/conflict] → [secure artifact/version]
→ [note editor with anchors/actions] → [scope/result preview] → [explicit finalization].
Partner deep: [parent notes] → [extra checks/evidence] → [note resolutions]
→ [M1–M7 assessments] → [remaining blockers] → [decision/attestation].
Admin: [date/WIB] → [standard/deep collected revenue] → [eligible-to-paid-to-completed
funnel] → [queue/decision age/reconciliation/revocation] → [safe drilldowns].
Mobile uses labeled tabs instead of cramped side panels; same keyboard/zoom/readability
criteria as original. No seal-like AI icon; Enhanced text must not imply guaranteed legality.

# Free User & Member Dashboard — Detailed UX

## Principle
**One dashboard for both plans**. AI drafting is free within fair-use limits. AI preliminary review is intended to be free but stays disabled in production until quota enforcement, privacy and security gates pass. Membership changes **daily quotas and human review pricing**, not the AI model or answer quality.

## First-time user dashboard
Header: logo + simple profile button. Greeting: `Selamat datang di Yuktanya`. Primary hero question: `Apa yang ingin Anda buat hari ini?`
Large primary CTA: `Buat dokumen baru (Gratis)`; secondary CTA: `Periksa dokumen saya` only once AI pre-review is enabled; otherwise show a clearly labeled informational/help route. Beneath, 3 recognizable options with descriptive subtitles:
1. `Perjanjian Kerja Sama` — untuk kerja sama usaha/proyek
2. `Surat Utang Piutang` — untuk pinjam-meminjam uang
3. `Perjanjian Kerahasiaan (NDA)` — untuk menjaga informasi rahasia
Explain in plain language that AI is not a lawyer. Do not overwhelm with other modules.
Simple persistent help: `Butuh bantuan?` with FAQ and human contact path (only if staffed).

## Returning user dashboard
Top: `Lanjutkan dokumen terakhir` if unfinished, one dominant CTA.
Below: `Dokumen Saya` (max 3 recent items), `Status Pemeriksaan` (if applicable), `Buat Dokumen Baru`.
Membership card lower priority. Notifications show only actionable issues.
Never show admin metrics, token counts, or AI provider names to consumers.

## Free account card
`Akun Gratis`; `Buat dokumen dengan AI: Gratis`; `Pemeriksaan pengacara: Rp50.000 per dokumen standar`.
Membership CTA only near human review or discreetly in account section.
Explain optional upgrade and do not imply mandatory payment for drafting.

## Member account card
`Member Aktif`; active billing period (actual dates); `Pemeriksaan pertama: Rp30.000` if unused, else `Pemeriksaan berikutnya: Rp35.000`.
Membership price `Rp19.000/bulan`. Clearly show whether first-review benefit has been used, and expiration date. Never say all reviews Rp30k.
If membership expired, fall back to nonmember pricing; show transparent renewal CTA.

## Mobile navigation
Prefer labeled 4 tabs: `Beranda`, `Buat Dokumen`, `Dokumen Saya`, `Akun`. `Review Saya` reachable prominently from document cards and dashboard status section; if testing reveals high use, promote to nav.
On desktop: sidebar `Beranda`, `Buat Dokumen`, `Dokumen Saya`, `Review Saya`, `Legal Vault`, `Membership`, `Bantuan`, `Pengaturan`. Avoid duplicating document library and Vault without clear distinction: Documents = work-in-progress, Vault = stored finalized/archived versions.

## Empty states
No documents: `Belum ada dokumen. Mulai dari membuat dokumen pertama Anda.` CTA `Buat Dokumen`.
No reviews: `Belum ada dokumen yang diperiksa pengacara.` CTA `Lihat cara pemeriksaan`.
AI unavailable: `Layanan AI sedang sibuk. Jawaban Anda sudah tersimpan.` CTA `Coba lagi`.
No payment: `Belum ada pembayaran.`

## Personalization and privacy
Display only own documents. Avoid sensitive document titles in lock-screen notifications. User can rename documents. Do not expose personal contract data in marketing analytics.

## Usage quota cards
Show `Sisa pesan AI: X dari 20` and `Sisa pembuatan dokumen: X dari 1` for Free; `X dari 60` and `X dari 5` for active Member, with reset `00.00 WIB`. Use plan-specific totals (Free 20/1, Member 60/5). Preserve access to existing documents after quota is reached.

## v8 — review results and pricing
User dashboard includes own standard/deep review status; no operational graphs. Show all three
quota counters including `Sisa pemeriksaan awal AI: X dari 2` (Member `X dari 10`) and explain
`Setiap pemeriksaan AI memakai 1 pesan AI`. Backend resetAt drives 00.00 WIB display.
Standard result shows `Selesai — Dengan Legal Note` or `Selesai — Tanpa Legal Note`, scope,
reviewer, date, exact reviewed version, report and verification code/QR. Notes show action
and severity with text, never color alone. With actionable notes and eligible standard only:
primary `Baca catatan`, then optional `Lihat pemeriksaan mendalam`. No direct deep purchase
from dashboard/pricing without eligibility. Informational pricing remains visible to everyone.
Deep offer states extra Rp200.000 Free / Rp150.000 Member, standard price already paid,
total payable now, optional nature and payment-not-positive-result notice. Show no cap promise.
Track deep timeline separately. At completion show extra report + Enhanced if authorized;
otherwise `Pemeriksaan tambahan selesai — cap Enhanced belum diberikan` with reason/action.
Edited document shows `Versi baru belum diperiksa`; older reports remain accessible as older.
Membership expiry changes future quotes, not settled price snapshots. QR revoked status
is explicit. Only show a supported help channel; no invented SLA.

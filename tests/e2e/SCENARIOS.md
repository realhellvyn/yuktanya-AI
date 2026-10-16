# E2E implementation catalogue — run selectively

Status (16 Okt 2026): aplikasi dan fixture sintetis sudah ada. Sebagian besar skenario diotomatisasi
sebagai perjalanan browser (`tests/e2e/journey*.mjs`, dijalankan `bash scripts/e2e/run.sh`), tes DB/handler
(`tests/db/*`, bagian `npm run check`) dan smoke rilis (`npm run test:smoke`). Beberapa hanya dicakup sebagian
atau tidak diotomatisasi; lihat bagian "Pemetaan otomasi" di bawah. Hasil lari nyata dicatat di laporan
rilis, bukan di berkas ini. Tag implementations `@auth`, `@standard`,
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
| E17b admin analytics (`journey-admin-analytics.mjs`) | Seed synthetic documents on fixed WIB days via DB (Free vs Member, NDA vs PKS, 23.59/00.00 WIB edges); admin changes type/membership filters and custom range; reversed range; 375px; non-admin | Trend charts render; numbers change with filters/range; Jakarta day boundaries; plain error keeps typed dates; no overflow/touch targets ≥43.5px; no document titles; non-admin denied |
| E17c data rights (`journey-data-rights.mjs`) | Chat draft typed then reload; offline toggle; send; two owners download their data; owner A (with published Standard Review verification) deletes account with wrong then correct confirmation; old login; public /verify; 375px /settings | Draft restored then cleared after send; offline banner + disabled Kirim; JSON parses and holds only own rows; fake Auth soft-deletes A; old session and login fail; /verify still Aktif without document text; B unaffected; no overflow/touch targets ≥43.5px |
| E18 UI | Keyboard/mobile/200% zoom, notes comprehension, negative Enhanced outcome | Readable price/status/action; no color-only state; payment understood as review fee, not cap purchase |

Release smoke selects E01–E06, E08–E14 and affected exception paths. Full matrix before major
release; unit/integration cover detailed permutations without unnecessary browser repetition.

## Pemetaan otomasi (diverifikasi terhadap berkas tes, 16 Okt 2026)
Sebutan: **J** = `tests/e2e/journey*.mjs` (browser, Postgres sementara + Auth palsu + gateway LLM palsu);
**DB** = `tests/db/*.test.ts` (Postgres sementara); **S** = `tests/smoke/release-smoke.test.ts`;
**U** = `tests/unit/*`. Perjalanan selain `journey.mjs` dan `journey-public.mjs` hanya berjalan di desktop
(`onlyViewport`), kecuali langkah yang memang memakai lebar 375px.

| ID | Status | Dicakup oleh | Yang belum dicakup |
|---|---|---|---|
| E01 | Otomatis | S `E01`; DB `chat-turn`, `prereview` (anonim 401, gateway tidak dipanggil); J `journey.mjs` ("/dashboard tanpa login dialihkan ke /login"), `journey-public` | Tidak ada langkah browser yang memanggil API AI tanpa sesi |
| E02 | Otomatis | S `E02`; DB `deep-handlers`, `deep-requests` (lintas firma), `review-handlers`; J `journey-roles` ("pengguna biasa dan akun reviewer saja ditolak di /admin dan /admin/payments"), `journey-ui-roles` ("akun reviewer saja ditolak di /partner/team dan /admin"), `journey-cases` (404/akses peran) | Akses berkas privat lintas pengguna diuji di tingkat DB/handler, bukan lewat unduhan di browser |
| E03 | Otomatis | S `E03`; DB `reviews`, `publish`, `review-handlers`; J `journey-roles` (standar Rp50.000 sampai terbit) | Jalur browser mencakup hasil WITH_NOTES; WITHIN_SCOPE tanpa catatan hanya di S/DB |
| E04 | Otomatis | S `E04`; J `journey-roles` ("reviewer ... menerbitkan WITH_NOTES", "pemilik melihat hasil", tawaran Deep Rp200.000) | |
| E05 | Otomatis | S `E05`; DB `deep-orders` (kelayakan), `deep-handlers`; J `journey-roles` (pemilik lain 404 di `/reviews/[id]/deep`) | Tampilan alasan tidak layak di browser hanya di U `deep-ui` |
| E06 | Otomatis | S `E06`; DB `deep-orders` ("harga deep"), `billing`; U `deep-ui`, `billing-ui` (standar dihitung terpisah, membership terpisah); J `journey-roles` (checkout Deep Rp200.000) | Browser hanya memesan sebagai Free; harga Member Rp150.000 diuji di S/DB |
| E07 | Otomatis (DB) | DB `billing` (Rp30.000/Rp35.000, dua order serentak = satu entitlement, kedaluwarsa melepas), `settlement` (AMOUNT_MISMATCH melepas diskon), `billing-integrity` (aktivasi rekonsiliasi tidak menggandakan diskon periode, pratinjau mengabaikan order kedaluwarsa, settlement membership serentak tidak tumpang tindih) | Tidak ada perjalanan browser; tidak masuk daftar smoke rilis |
| E08 | Otomatis | S `E08`; DB `settlement`, `deep-requests`; J `journey-roles` (transfer bank belum lunas, admin konfirmasi, baru masuk antrean) | Screenshot pembayaran palsu hanya diuji sebagai "provider_ref tak dikenal" |
| E09 | Otomatis | S `E09`; DB `deep-decision`; J `journey-roles` ("checklist M1-M7 dan menyetujui Enhanced", "pemilik melihat Enhanced") | |
| E10 | Otomatis (S/DB) | S `E10`; DB `deep-decision` (MATERIAL_FAIL, UNKNOWN, tanpa bukti/atestasi, catatan material belum selesai) | Tidak ada perjalanan browser untuk hasil negatif; teks hasil negatif di U `deep-ui` |
| E11 | Otomatis (S/DB) | S `E11`; DB `deep-decision` ("UNAUTHORIZED_REVIEWER"), `deep-handlers` (admin 403) | Tab/penugasan basi di browser tidak diuji; reauth UI tidak diuji |
| E12 | Otomatis | S `E12`; DB `verification` ("versi yang diedit tidak mewarisi verifikasi"), `documents`, `exports` (hash ekspor berbeda); J `journey-roles` ("versi baru ... belum diperiksa, tanpa lencana (E12)") | Replay penyelesaian basi: DB `deep-decision` (STALE_REVISION) |
| E13 | Otomatis | S `E13`; DB `verification`, `verification-service`, `deep-decision`; J `journey-roles` ("admin mencabut; publik langsung Dicabut"), `journey-public`, `journey-data-rights` (/verify tetap Aktif) | Pemindaian QR kamera tidak diuji; hanya halaman tujuan |
| E14 | Otomatis | S `E14`; DB `quota`, `quota-store`, `entitlement`; J `journey.mjs` ("kuota awal 20 dari 20"), `journey-ai-review` (jatah berkurang) | Batas Free/Member penuh hanya di S/DB |
| E15 | Sebagian | DB `quota` (konkurensi, release, TTL, batas hari WIB 16:59:59Z/17:00:00Z, upgrade/kedaluwarsa tengah hari), `chat-turn` (gateway gagal melepas kuota, kunci idempoten, AI_BUSY), `prereview`; J `journey.mjs` ("gateway gagal ... Coba lagi berhasil") | Tengah malam WIB nyata tidak disimulasikan di browser (jam diinjeksi di DB); balapan paralel hanya di DB |
| E16 | Sebagian | DB `deep-orders` (order kedaluwarsa membuka kembali, harga plan saat order, pembayaran terlambat = rekonsiliasi), `deep-requests` (induk dicabut sebelum settlement = RECONCILIATION_REQUIRED), `settlement`, `billing-handlers` (ACTIVATE tidak layak = 409) | "Penawaran/quote kedaluwarsa dengan harga yang diterima tetap dihormati" tidak ada sebagai tes terpisah; tidak ada perjalanan browser |
| E17 | Otomatis (DB) | DB `admin-metrics` (pendapatan hanya VERIFIED, funnel kohort, "tanpa data" null, refund); J `journey-ui-roles` (halaman admin tampil) | Pemisahan Standard vs Deep di UI tidak diuji di browser |
| E17b | Otomatis | J `journey-admin-analytics.mjs` (desktop + 375px); DB `admin-metrics` (admin_analytics), `analytics-events` | |
| E17c | Otomatis | J `journey-data-rights.mjs` (desktop + 375px); DB `data-rights`; U `data-rights` | Penghapusan akun Auth memakai Auth palsu; Auth nyata belum diuji |
| E18 | Sebagian; sisanya **tidak diotomatisasi** | J memeriksa tanpa scroll horizontal, target sentuh >= 43,5/44px, tanpa error konsol pada halaman utama (mobile 375px); U `deep-ui`, `billing-ui` memeriksa kata "Enhanced"/pernyataan pembayaran dan tanpa kata "cap" | Navigasi keyboard, zoom 200%, pemahaman catatan, dan keterbacaan hasil negatif membutuhkan uji kegunaan manusia (lihat docs/USABILITY_TEST_PLAN.md); status tidak hanya warna belum diaudit otomatis |

Catatan: E2E selalu memakai flag `DEEP_REVIEW_PURCHASE`, `ENHANCED_ISSUANCE`, `AI_PREREVIEW_ENABLED` = true,
`ALLOW_UNAPPROVED_TEMPLATES=true`, gateway LLM palsu, dan Auth Supabase palsu; ini bukan bukti integrasi
dengan Supabase Auth, Storage, penyedia pembayaran atau gateway LLM nyata.

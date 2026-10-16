# Verification & Review Outcome Policy — Canonical v8

## Three record kinds; two basic processes plus enhanced legal outcome
| Stored kind | Visible title | Required evidence |
|---|---|---|
| AI | Yuktanya AI Verified — Pemeriksaan Awal oleh AI | Successful saved preliminary analysis, exact version/hash, request ID, policy version |
| LEGAL | Yuktanya Legal Verified | Completed authorized Standard Review, signed-off report, scope, qualifications snapshot, outcome |
| LEGAL_ENHANCED | Yuktanya Legal Verified — Enhanced | Completed extra Deep Review, valid parent Standard Review with actionable notes, all required material criteria confirmed by authorized professional |

AI completion is NOT legal approval, signature, stamp or factual authenticity certification.
Legal Verified means professional review of a specific version within stated scope and
assumptions. None promises notarization, enforceability, a court result or universal validity.
Professional stamp/signature is separate and allowed only if professionally appropriate,
authorized and in engagement; the Enhanced brand cap is not a notarial/official seal.

## Standard Review outcomes
- WITH_NOTES / `Dengan Legal Note`: completed professional report includes published notes.
  Display severity, required action and unresolved issues openly; not a clean pass.
- WITHIN_SCOPE / `Tanpa Legal Note — Sesuai Lingkup Pemeriksaan`: no outstanding notes
  and professional affirmatively concludes defined criteria met within scope/evidence.
- INCONCLUSIVE, DECLINED or INCOMPLETE: show report/status as applicable; no legal badge.
  Inability to conclude must not be rewritten as WITH_NOTES merely to issue a badge.
Whether a particular adverse-but-completed report permits WITH_NOTES is a partner launch
gate. Default to no badge when professional conclusion/authorization is absent.

## Enhanced decision
Read DEEP_REVIEW.md. Settled payment only queues work. Authorized reviewer must record
the extra work, note-by-note disposition, material checklist and explicit APPROVE decision.
Any required FAIL or UNKNOWN blocks Enhanced. N/A needs justification and is forbidden
for policy-marked mandatory criteria. OUT_OF_SCOPE material issues block or escalate.
Deep completion may be ENHANCED_APPROVED, COMPLETED_WITH_NOTES, INCONCLUSIVE or
REFERRED_SPECIAL_CASE. All are real outcomes; only first can issue Enhanced.
Unsuccessful enhanced decision does not automatically revoke the original standard record;
professional reassessment may trigger separate audited revocation if original was misleading.

## Immutable evidence and atomic issuance
Every record: id, kind, document/version IDs, exact-byte SHA-256, status, issued_at UTC,
scope/assumptions/limitations, policy version, audit event, opaque verification code.
AI adds logical request/report/analyzer references; legal adds report/review, firm,
reviewer and authority snapshot; Enhanced adds parent Standard Review and extra approval.
Freeze reviewed bytes before processing. Compute hash server-side, compare at submission
and completion. Legal review/report completion + decision + verification insert + audit
must commit atomically (outbox for QR/export side effects). Unique completion keys prevent
duplicates. Final reports, checklist assessments, and issued evidence cannot be edited.
Corrections use new report/version and revocation/reissue, never overwrite history.

Preserve original assessed file; stamped/export wrapper has its own export hash and
points to the original assessment hash. Never create self-referential PDF hashing by
claiming a hash embedded in a PDF is that PDF's final hash. Edited versions have no badge.
Historical verification remains bound to the old version and clearly says so internally.

## QR and public verification
Generate QR to configured HTTPS canonical origin `/verify/[opaque-code]` for each new
record. Include readable URL/code for users who cannot scan; no PII inside QR.
Public server projection: kind, active/revoked/not-found status, issue date, verification
code, reviewed artifact SHA-256, approved non-sensitive scope and display issuer only
after privacy signoff. Never body, parties' names, private notes, documents, credentials
or signed download URLs. No enumeration/list endpoint; rate limit code lookups.
Public hash comparison may be client-local, without uploading confidential file bytes.
QR identifies a lookup; it is not a cryptographic signature or proof parties signed.
Public scope/issuer fields can be withheld until approved; do not enable private fallback.

## Revocation
Authorized verification-revoke capability, recorded reason code, safe public status,
private rationale, actor and UTC time. Reviewer may request revocation; platform admin
can execute operational revocation under policy but cannot approve legal findings.
Record revocation as append-only event; status projection may update. Public lookup must
immediately show revoked (disable caching or invalidate synchronously). Existing QR remains
resolvable. No deletion/reassignment of record. Revoked parent makes pending deep work
ineligible; existing Enhanced requires immediate review and conservative suspended/invalid
public status until dependency is resolved, never continue presenting an active cap.

## Mandatory visible language
- AI: `Analisis otomatis untuk versi dokumen ini telah selesai. Bukan pengesahan hukum dan belum diperiksa pengacara.`
- Standard with notes: `Pemeriksaan selesai dengan catatan. Baca catatan sebelum menggunakan dokumen.`
- Standard without notes: `Pemeriksa menyatakan dokumen memenuhi kriteria dalam ruang lingkup pemeriksaan yang tercantum.`
- Enhanced: `Versi ini telah melalui pemeriksaan tambahan oleh profesional hukum dan memenuhi kriteria material dalam lingkup yang tercantum.`
- All legal results: `Tidak menjamin keabsahan atau hasil hukum dalam semua keadaan.`
- Checkout: `Pembayaran adalah biaya pemeriksaan. Tidak menjamin hasil positif atau penerbitan cap Enhanced.`

Partner/legal approval of terms, rubric, scope, qualifications, claims and professional
signature workflow remains a production gate. This is a software policy, not legal advice.

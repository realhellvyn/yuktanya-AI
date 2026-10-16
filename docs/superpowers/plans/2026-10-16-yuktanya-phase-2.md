# Yuktanya Phase 2 Implementation Plan — Template, Dokumen, Versi Tak Berubah, Ekspor, Vault

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pengguna terautentikasi mengisi wawancara terstruktur untuk PKS, Utang Piutang, atau NDA, membekukan hasilnya menjadi versi tak berubah ber-SHA-256, mengekspor DOCX/PDF, membandingkan versi, dan melihat riwayatnya di Vault.

**Architecture:** Template dan skema ada di kode; status persetujuan template ada di DB (terikat hash isi) sehingga template yang berubah otomatis tidak lagi disetujui. Renderer deterministik menghasilkan blok dokumen; byte kanonik disimpan sebagai teks di DB dan di-hash oleh DB (`sha256(bytea)`). Operasi bernilai (buat, simpan draf, bekukan, daftar ekspor) berupa fungsi SQL `SECURITY DEFINER` yang memeriksa pemilik; ekspor disimpan lewat antarmuka `BlobStore`.

**Tech Stack:** lanjutan Fase 0–1 (Next.js 16, pg, zod, Vitest) + `docx` (DOCX), `pdf-lib` (PDF), `jszip` (dev, hanya untuk tes).

**Spec:** `docs/superpowers/specs/2026-10-16-yuktanya-v8-extension-design.md` (§4.4, §6.3, §8, §10). Blueprint: `docs/DATA_MODEL.md`, `docs/PERMISSIONS.md`, `docs/AI_FAIR_USAGE.md`, `docs/WORKFLOWS.md` §B, `docs/ARCHITECTURE.md` (Document engine), `docs/VERIFICATION_POLICY.md` (hash ekspor), `docs/USER_FLOWS.md`, `docs/WIREFRAMES.md` 5–7 dan 11. Fase sebelumnya: `docs/superpowers/plans/2026-10-16-yuktanya-phase-0-1.md`.

**Pengurutan, bukan pemotongan:** fitur Vault berbadan (berbagi, paket bukti, pengingat) dan wawancara berbantuan AI dikerjakan di rencana Fase 2b setelah versi dan hash ini berdiri (spec §12). Fase ini meletakkan fondasinya: versi tak berubah, diff, ekspor, dan Vault dasar.

## Global Constraints

- UI Bahasa Indonesia sederhana: satu pertanyaan per layar, contoh pengisian, `Wajib`/`Opsional`, `Kembali` tidak menghapus jawaban, tombol utama satu, target sentuh ≥ 48px, tidak ada jargon.
- Teks wajib: draf AI `Dibuat dengan bantuan AI. Belum diperiksa oleh profesional hukum.` (sudah di `src/lib/copy.ts`). Kata "cap" tidak dipakai di UI (glosarium spec).
- Uang integer IDR; tanggal disimpan ISO `YYYY-MM-DD`, ditampilkan `16 Oktober 2026`.
- Tidak boleh ada fakta karangan: nama, jumlah, tanggal, atau kutipan hukum hanya dari input pengguna. Field wajib kosong atau hanya spasi menolak pembekuan; renderer tidak pernah menulis placeholder `{{...}}` atau nilai bawaan.
- Template di produksi hanya yang `APPROVED` di DB dengan `content_hash` yang sama dengan kode. Ketiga template di fase ini berstatus `DRAFT`, bersifat sintetis/placeholder menunggu sign-off mitra; di luar produksi hanya boleh dipakai bila `ALLOW_UNAPPROVED_TEMPLATES=true`, dan ekspornya memuat label `Template belum disetujui mitra hukum`.
- Versi dokumen tak berubah (tanpa UPDATE/DELETE, termasuk untuk `service_role`); hash dihitung DB atas byte UTF-8 `canonical_text`; sunting setelah beku selalu membuat versi baru tanpa mewarisi apa pun. Hash ekspor (DOCX/PDF) tersendiri dan merujuk versi sumber (`VERIFICATION_POLICY.md`).
- Kuota dokumen baru (Free 1 / Member 5 per hari WIB) dikonsumsi saat **versi pertama** dokumen berhasil dibekukan, bukan saat wawancara dimulai. Versi berikutnya, ekspor, dan unduhan tidak memakai kuota. Penyalinan dokumen memakai satu kuota pada pembekuan pertamanya.
- Semua akses data lewat server; pemilik ditentukan dari sesi, tidak dari klien. ID milik orang lain mengembalikan 404 dengan badan yang sama seperti ID tidak ada.
- Hanya data sintetis. CI hanya `workflow_dispatch`; pemeriksaan harian `npm run check`. Tidak ada E2E/Playwright; laporkan hanya tes yang benar-benar dijalankan.
- Setiap commit diakhiri: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` dan `Claude-Session: https://claude.ai/code/session_016B7SX6nyHrmjD4FoWDsi9m`. Branch kerja: `claude/great-cerf-8hwfjk`.
- Default rekayasa (bukan keputusan pemilik; tandai di kode): batas draf aktif per pengguna 20, masa berlaku URL unduhan tidak berlaku (unduhan lewat rute berotorisasi).

## Review Focus

1. Field wajib kosong, hanya spasi, atau tidak diisi: pembekuan ditolak dengan daftar field; tidak ada teks `[nama]`/`{{...}}` di hasil. (Task 3, 5)
2. Input jumlah/tanggal gaya Indonesia: `Rp5.000.000`, `5.000.000`, `5000000`, `1,5`, `-1`, `Rp 0`, angka di atas `Number.MAX_SAFE_INTEGER`, `31 Februari 2026`, tanggal jatuh tempo sebelum tanggal perjanjian. (Task 1–2)
3. Data sama → hash sama; satu karakter beda → hash beda; byte versi lama tidak berubah setelah sunting dan versi baru. (Task 4–5)
4. IDOR: dokumen/versi/ekspor milik orang lain, termasuk parameter `against` pada diff dan jalur blob dengan `..`, selalu 404/ditolak tanpa membocorkan keberadaan. (Task 4, 7–9)
5. Kirim ganda: pembekuan dengan kunci idempoten sama atau serentak menghasilkan satu versi dan satu unit kuota; kuota habis tidak menghilangkan draf. (Task 4–5, 9)

## File Structure

```
src/lib/documents/{types,format,render,diff,service,wizard,export,blob,templates/{nda,pks,utang-piutang,registry}}.ts
src/lib/documents/handlers.ts            # handler berinjeksi dependensi (pola handle-chat)
src/app/api/documents/**/route.ts        # tipis, memanggil handlers
src/app/(app)/{workspace/new,workspace/[id],documents,documents/[id],vault}/page.tsx
src/components/documents/{wizard-step,document-preview,version-list}.tsx
supabase/migrations/2026101600000{6,7,8}_*.sql
tests/db/{templates,documents,exports}.test.ts   tests/unit/{format,render,diff,wizard,export,blob,document-ui}.test.ts
```

---

### Task 1: Parsing dan format ID (IDR, tanggal)

**Files:** Create `src/lib/documents/format.ts`, `tests/unit/format.test.ts`.

**Interfaces:** Produces `parseIdr(raw: string): number` (melempar `FormatError`); `parseDateId(raw: string): string` (ISO, menerima `16 Oktober 2026`, `16/10/2026`, `2026-10-16`; melempar `FormatError`); `formatDateId(iso: string): string`; `class FormatError extends Error { field?: string }`. Consumes `formatIdr` dari `@/lib/pricing/catalog`.

- [ ] **Step 1: Failing tests** `format.test.ts`: `parseIdr("Rp5.000.000")`, `("5.000.000")`, `("5000000")`, `(" Rp 5.000.000 ")` → `5000000`; `parseIdr("0")` dan `("Rp 0")` → `0` (validasi positif dilakukan skema, bukan parser); ditolak (`FormatError`): `"1,5"`, `"-1"`, `"abc"`, `""`, `"5.000.000,00"`, `"9007199254740993"`. `parseDateId("16 Oktober 2026")`, `("16/10/2026")`, `("2026-10-16")` → `"2026-10-16"`; `("31 Februari 2026")`, `("2026-13-01")`, `("")` ditolak. `formatDateId("2026-10-16")` → `"16 Oktober 2026"`.
- [ ] **Step 2:** `npx vitest run tests/unit/format.test.ts` → FAIL (modul belum ada).
- [ ] **Step 3: Implement** fungsi di atas; validasi tanggal dengan membandingkan hasil `Date.UTC` kembali ke komponen (menolak 31 Februari); nama bulan Indonesia sebagai tabel konstanta.
- [ ] **Step 4:** tes PASS. **Step 5: Commit** `feat(documents): Indonesian money and date parsing`.

### Task 2: Model template, tiga template sintetis, dan skema

**Files:** Create `src/lib/documents/types.ts`, `src/lib/documents/templates/{nda,pks,utang-piutang}.ts`, `tests/unit/templates.test.ts`.

**Interfaces:** Produces `type Category = "PKS" | "UTANG_PIUTANG" | "NDA"`; `type FieldSpec = { key: string; label: string; example?: string; help: string; kind: "text"|"longtext"|"idr"|"date"|"integer"|"choice"; required: boolean; options?: string[] }`; `type ClauseSpec = { id: string; heading?: string; text: string /* memuat {{key}} */; when?: (d: Data) => boolean }`; `type Data = Record<string, string | number>`; `type Template = { id: string; category: Category; version: number; title: string; fields: FieldSpec[]; clauses: ClauseSpec[]; validate(d: Data): { ok: true; data: Data } | { ok: false; errors: Record<string, string> }; contentHash(): string }`.

- [ ] **Step 1: Failing tests:** per kategori, data sintetis valid lolos `validate`; setiap field `required` yang kosong/spasi menghasilkan error pada key-nya; Utang Piutang: `principalIdr` ≤ 0 atau desimal ditolak, `dueDate` ≤ `signingDate` ditolak; semua kategori: dua pihak dengan nama sama (tanpa membedakan huruf besar/kecil dan spasi) ditolak; `contentHash()` stabil dua kali dipanggil dan berubah bila satu klausul diubah (uji dengan salinan template dimodifikasi); setiap `{{key}}` di klausul merujuk field yang ada (tes konsistensi).
- [ ] **Step 2:** FAIL. **Step 3: Implement** tiga template dengan klausul placeholder netral (mis. judul, para pihak, ruang lingkup, jangka waktu, pembayaran, pengakhiran, penyelesaian sengketa dengan `{{disputeCity}}`), setiap file diberi komentar `SINTETIS: menunggu persetujuan mitra hukum`; `contentHash` = SHA-256 dari JSON kanonik `{id, version, fields, clauses[{id,heading,text}]}` (fungsi `when` tidak ikut, diganti penanda tekstual `whenKey`).
- [ ] **Step 4:** PASS. **Step 5: Commit** `feat(documents): templates and validation schemas (draft, synthetic)`.

### Task 3: Renderer deterministik dan byte kanonik

**Files:** Create `src/lib/documents/render.ts`, `tests/unit/render.test.ts`.

**Interfaces:** Consumes `Template`, `Data`, `AI_DRAFT_LABEL`. Produces `type Block = { id: string; kind: "title"|"heading"|"paragraph"; text: string }`; `type RenderedDoc = { templateId: string; templateVersion: number; category: Category; approval: "APPROVED"|"DRAFT"; label: string; blocks: Block[] }`; `class MissingFieldsError extends Error { fields: string[] }`; `renderDocument(t: Template, data: Data, approval: "APPROVED"|"DRAFT"): RenderedDoc`; `canonicalize(doc: RenderedDoc): string` (JSON dengan kunci terurut, tanpa spasi); `parseCanonical(text: string): RenderedDoc`.

- [ ] **Step 1: Failing tests:** data sintetis dengan nilai sentinel unik → setiap sentinel muncul tepat di tempat klausulnya dan tidak ada `{{` di hasil; field wajib hilang → `MissingFieldsError` dengan daftar key; input sama dua kali → `canonicalize` identik byte demi byte; mengubah satu karakter nilai → string kanonik berbeda; `approval: "DRAFT"` menambah blok label `Template belum disetujui mitra hukum`, `"APPROVED"` tidak; `parseCanonical(canonicalize(d))` sama dengan `d`; klausul dengan `when` false tidak dirender; nama dengan karakter Unicode/diakritik dan tanda kutip dipertahankan.
- [ ] **Step 2:** FAIL. **Step 3: Implement**; substitusi memakai `formatIdr`/`formatDateId` sesuai `kind` field; `label` selalu `AI_DRAFT_LABEL`.
- [ ] **Step 4:** PASS. **Step 5: Commit** `feat(documents): deterministic renderer and canonical bytes`.

### Task 4: Persetujuan template, dokumen, dan versi tak berubah (DB)

**Files:** Create `supabase/migrations/20261016000006_templates.sql`, `supabase/migrations/20261016000007_documents.sql`, `tests/db/templates.test.ts`, `tests/db/documents.test.ts`.

**Interfaces:** Produces tabel `document_templates(template_id text, version int, content_hash text, approval_status text check in ('DRAFT','APPROVED','RETIRED'), approved_by uuid, approved_at timestamptz, primary key(template_id, version))`; `documents(id, owner_id, category, template_id, template_version, title, idempotency_key, created_at, unique(owner_id, idempotency_key))`; `document_drafts(document_id pk, structured_data jsonb, revision int, updated_at)`; `document_versions(id, document_id, version_no, canonical_text text, sha256 text, structured_data jsonb, template_id, template_version, created_at, unique(document_id, version_no))` dengan trigger tolak UPDATE/DELETE/TRUNCATE; `document_exports(id, version_id, format check in ('DOCX','PDF'), sha256, byte_size, storage_path, created_at)`; fungsi (hanya `service_role`): `is_template_approved(p_template_id text, p_version int, p_hash text) returns boolean`, `create_document(p_user uuid, p_category text, p_template_id text, p_template_version int, p_title text, p_key text) returns uuid`, `save_draft(p_user uuid, p_document uuid, p_data jsonb, p_revision int) returns int` (melempar `STALE_REVISION`, `NOT_FOUND`), `freeze_version(p_user uuid, p_document uuid, p_canonical text, p_data jsonb, p_key text, p_now timestamptz) returns table(status text, version_id uuid, version_no int, sha256 text, reset_at timestamptz)` dengan `status` `CREATED|DUPLICATE|QUOTA_DOCUMENT`, `register_export(p_user uuid, p_version uuid, p_format text, p_sha text, p_size int, p_path text) returns uuid`. RLS: pemilik hanya SELECT tabel miliknya; tidak ada tulis klien.

- [ ] **Step 1: Failing tests** `templates.test.ts`: `is_template_approved` false untuk DRAFT, tidak ada, atau hash beda; true untuk APPROVED dengan hash sama; `authenticated` tidak dapat menulis atau memanggil. `documents.test.ts`: (a) `create_document` idempoten per `(owner, key)`; batas 20 draf aktif per user → error `TOO_MANY_DRAFTS`; (b) `freeze_version` versi pertama: `CREATED`, `sha256` = SHA-256 hex dari byte UTF-8 `canonical_text` yang dihitung ulang di tes dengan `node:crypto`, dan kuota dokumen terpakai 1; (c) Free hari yang sama: dokumen kedua → `QUOTA_DOCUMENT` dan tidak ada baris versi, draf tetap ada; (d) versi ke-2 dokumen yang sama tidak memakai kuota dan `version_no` = 2; (e) kunci idempoten sama (berurutan dan dua koneksi serentak) → satu versi, satu unit kuota (`DUPLICATE` untuk yang kedua); (f) UPDATE/DELETE `document_versions` ditolak untuk `service_role` dan superuser lewat trigger; (g) `save_draft` dengan revisi basi → `STALE_REVISION`; (h) pengguna B memanggil `save_draft`/`freeze_version`/`register_export` pada dokumen/versi A → `NOT_FOUND`, dan `select` RLS B atas milik A → 0 baris; (i) fungsi tidak dapat dieksekusi `authenticated` (42501).
- [ ] **Step 2:** `npm run test:db` → FAIL. **Step 3: Implement** migrasi. `freeze_version`: kunci advisory per pengguna-hari (pola `reserve_usage`); pembekuan pertama memanggil `reserve_usage(p_user, 'DOCUMENT', 'doc:' || p_document, p_now)` lalu `finalize_usage` dalam transaksi yang sama; hash `encode(sha256(convert_to(p_canonical, 'UTF8')), 'hex')`; kunci idempoten `p_key` unik per dokumen.
- [ ] **Step 4:** `npm run test:db` → PASS. **Step 5: Commit** `feat(db): template approval, documents, immutable hashed versions`.

### Task 5: Layanan dokumen (TS) dan pintu persetujuan template

**Files:** Create `src/lib/documents/service.ts`, `src/lib/documents/templates/registry.ts`, `tests/db/service.test.ts`.

**Interfaces:** Consumes Task 2–4. Produces `getTemplate(category: Category, opts: { allowUnapproved: boolean; isApproved: (id: string, version: number, hash: string) => Promise<boolean> }): Promise<{ template: Template; approval: "APPROVED"|"DRAFT" }>` (melempar `TemplateNotApprovedError`); `type DocumentsService = { create(userId: string, category: Category, key: string): Promise<{ documentId: string }>; saveDraft(userId: string, documentId: string, data: Data, revision: number): Promise<{ revision: number }>; freeze(userId: string, documentId: string, key: string, now?: Date): Promise<FreezeResult>; list(userId: string): Promise<DocSummary[]>; get(userId: string, documentId: string): Promise<DocDetail | null>; getVersion(userId: string, versionId: string): Promise<VersionDetail | null> }`; `type FreezeResult = { ok: true; versionId: string; versionNo: number; sha256: string; duplicate: boolean } | { ok: false; code: "VALIDATION_FAILED"; errors: Record<string, string> } | { ok: false; code: "DOCUMENT_DAILY_QUOTA_REACHED"; resetAt: string } | { ok: false; code: "TEMPLATE_NOT_APPROVED" }`; `createPgDocumentsService(pool: Pool, env: { ALLOW_UNAPPROVED_TEMPLATES?: string; NODE_ENV?: string }): DocumentsService`.

- [ ] **Step 1: Failing tests** (`service.test.ts`, DB nyata): produksi (`NODE_ENV=production`) dengan template DRAFT → `freeze` mengembalikan `TEMPLATE_NOT_APPROVED`, tanpa versi dan tanpa kuota; `ALLOW_UNAPPROVED_TEMPLATES=true` di non-produksi → lolos dengan blok label `Template belum disetujui mitra hukum`; approval `APPROVED` dengan hash cocok di produksi lolos, hash beda → ditolak; data tidak valid (nama kosong/spasi, jumlah negatif) → `VALIDATION_FAILED` dengan key field, tanpa versi, tanpa kuota, draf tetap; data valid → `sha256` sama dengan SHA-256 canonical hasil `renderDocument` yang dihitung di tes; ubah draf lalu `freeze` kunci baru → versi ke-2 dan byte `canonical_text` versi 1 tidak berubah; Free: `freeze` dokumen kedua di hari sama → `DOCUMENT_DAILY_QUOTA_REACHED` dengan `resetAt` WIB dan drafnya masih dapat dibaca; `get`/`getVersion`/`saveDraft`/`freeze` oleh pengguna lain → `null`/`NOT_FOUND`.
- [ ] **Step 2:** FAIL. **Step 3: Implement**; `freeze` memuat draf, memanggil `template.validate`, `renderDocument`, `canonicalize`, lalu `freeze_version`; `DUPLICATE` dipetakan ke `duplicate: true`.
- [ ] **Step 4:** PASS. **Step 5: Commit** `feat(documents): service with approval gate, validation, freeze`.

### Task 6: Diff antar versi

**Files:** Create `src/lib/documents/diff.ts`, `tests/unit/diff.test.ts`.

**Interfaces:** Produces `type BlockChange = { id: string; change: "added"|"removed"|"changed"|"same"; before?: string; after?: string }`; `diffRendered(a: RenderedDoc, b: RenderedDoc): BlockChange[]` (urutan mengikuti `b` lalu blok yang hanya ada di `a`).

- [ ] **Step 1: Failing tests:** dokumen identik → semua `same`; satu nilai field berubah → tepat satu `changed` dengan `before`/`after` benar; klausul bersyarat muncul → `added`; hilang → `removed`; urutan keluaran deterministik; tidak ada pemanggilan AI/jaringan (fungsi murni).
- [ ] **Step 2:** FAIL. **Step 3: Implement** berbasis `Block.id`. **Step 4:** PASS. **Step 5: Commit** `feat(documents): deterministic version diff`.

### Task 7: BlobStore dan pembuat DOCX/PDF

**Files:** Create `src/lib/documents/blob.ts`, `src/lib/documents/export.ts`, `tests/unit/blob.test.ts`, `tests/unit/export.test.ts`, `supabase/migrations/20261016000008_storage_bucket.sql`; Modify `package.json` (`docx`, `pdf-lib`, dev `jszip`).

**Interfaces:** Produces `interface BlobStore { put(path: string, bytes: Uint8Array): Promise<void>; get(path: string): Promise<Uint8Array | null> }`; `createFsBlobStore(rootDir: string): BlobStore`; `createSupabaseBlobStore(client: SupabaseClient, bucket: string): BlobStore` (tipis, belum dapat diuji di lingkungan ini); `exportDocx(doc: RenderedDoc): Promise<Uint8Array>`; `exportPdf(doc: RenderedDoc): Promise<Uint8Array>`; `sha256Hex(bytes: Uint8Array): string`.

- [ ] **Step 1: Failing tests:** `blob`: put/get roundtrip; `get` path tak ada → `null`; path dengan `..`, awalan `/`, atau karakter `\0` ditolak di `put` dan `get`; tidak dapat keluar dari `rootDir`. `export`: DOCX berawalan `PK` dan, dibuka dengan `jszip`, `word/document.xml` memuat judul dan nilai sentinel serta label `AI_DRAFT_LABEL`; PDF berawalan `%PDF`, dapat dimuat ulang `PDFDocument.load` dengan ≥ 1 halaman, dokumen berisi paragraf sangat panjang menghasilkan > 1 halaman; karakter di luar WinAnsi diganti `?` tanpa melempar; `sha256Hex` sama dengan `node:crypto`.
- [ ] **Step 2:** FAIL. **Step 3: Implement**; migrasi bucket memakai `do $$ ... if to_regclass('storage.buckets') is not null then insert ... on conflict do nothing` untuk bucket privat `documents` (no-op di Postgres tes).
- [ ] **Step 4:** PASS. **Step 5: Commit** `feat(documents): blob store, DOCX and PDF exporters`.

### Task 8: Layanan ekspor dan unduhan berverifikasi hash

**Files:** Create `tests/db/exports.test.ts`; Modify `src/lib/documents/service.ts`.

**Interfaces:** Consumes Task 5, 7. Adds to `DocumentsService`: `exportVersion(userId: string, versionId: string, format: "DOCX"|"PDF"): Promise<{ exportId: string; sha256: string; byteSize: number } | null>`; `downloadExport(userId: string, exportId: string): Promise<{ bytes: Uint8Array; filename: string; contentType: string } | null>` (melempar `IntegrityError` bila hash berkas ≠ hash tercatat). `createPgDocumentsService` menerima `blob: BlobStore`.

- [ ] **Step 1: Failing tests:** ekspor milik sendiri → baris `document_exports` dengan `sha256` = hash byte berkas dan **bukan** hash versi, path berawalan `{userId}/{documentId}/`; ekspor versi orang lain → `null`; unduh orang lain → `null`; berkas di blob diubah → `IntegrityError`; dua ekspor format sama dari versi sama boleh berbeda hash dan keduanya tercatat; ekspor tidak memakai kuota (`snapshot` tidak berubah); ekspor dari canonical hasil `parseCanonical` identik isinya dengan render ulang.
- [ ] **Step 2:** FAIL. **Step 3: Implement** (`parseCanonical` → exporter → `blob.put` → `register_export`). **Step 4:** PASS. **Step 5: Commit** `feat(documents): export service with integrity-checked download`.

### Task 9: Handler API dokumen dan rute tipis

**Files:** Create `src/lib/documents/handlers.ts`, `src/app/api/documents/route.ts`, `src/app/api/documents/[id]/route.ts`, `src/app/api/documents/[id]/draft/route.ts`, `src/app/api/documents/[id]/versions/route.ts`, `src/app/api/documents/versions/[versionId]/route.ts`, `.../[versionId]/diff/route.ts`, `.../[versionId]/exports/route.ts`, `src/app/api/documents/exports/[exportId]/route.ts`, `tests/db/document-handlers.test.ts`.

**Interfaces:** Consumes `DocumentsService`. Produces `type DocDeps = { getUserId(): Promise<string | null>; service: DocumentsService; now?: () => Date }` dan fungsi `(deps: DocDeps, req: Request, params?: Record<string, string>) => Promise<Response>`: `createDocumentHandler`, `getDocumentHandler`, `saveDraftHandler`, `freezeHandler`, `listDocumentsHandler`, `getVersionHandler`, `diffHandler` (`?against=<versionId>`), `exportHandler` (`{ format }`), `downloadHandler`. Kode galat: `AUTH_REQUIRED` 401, `INVALID_REQUEST` 400, `NOT_FOUND` 404, `VALIDATION_FAILED` 422 (dengan `errors`), `STALE_REVISION` 409, `DOCUMENT_DAILY_QUOTA_REACHED` 429 (`Retry-After`), `TEMPLATE_NOT_APPROVED` 409. Pembekuan dan pembuatan wajib `Idempotency-Key`.

- [ ] **Step 1: Failing tests:** anonim di setiap handler → 401 dan `service` tidak dipanggil; tanpa `Idempotency-Key` pada create/freeze → 400; ID orang lain (dokumen, versi, ekspor) → 404 dengan badan identik dengan ID acak; `diff` dengan `against` milik orang lain → 404; validasi gagal → 422 berisi `errors` per field dan draf utuh; kuota habis → 429 dengan `Retry-After` > 0; kunci sama dua kali → satu versi dan kuota 1 unit; body klien berisi `owner_id`/`plan` diabaikan; unduh mengembalikan `content-type` benar, `content-disposition: attachment`, dan `cache-control: private, no-store`.
- [ ] **Step 2:** FAIL. **Step 3: Implement** (zod untuk body; rute tipis menyusun `DocDeps` dari `getSessionRoles`, pool, dan `createFsBlobStore(process.env.DOCUMENT_BLOB_DIR ?? ".data/blobs")`; di produksi memakai `createSupabaseBlobStore` bila env Supabase ada). Tambahkan `.data/` ke `.gitignore`.
- [ ] **Step 4:** PASS. **Step 5: Commit** `feat(api): documents, versions, diff, export endpoints`.

### Task 10: Model wizard wawancara

**Files:** Create `src/lib/documents/wizard.ts`, `tests/unit/wizard.test.ts`.

**Interfaces:** Produces `type Step = { index: number; total: number; field: FieldSpec }`; `buildSteps(t: Template): Step[]` (urutan = urutan `fields`); `nextMissing(t: Template, data: Data): Step | null`; `progress(t: Template, data: Data): { done: number; total: number; percent: number }`; `summarize(t: Template, data: Data): { label: string; value: string }[]` (nilai sudah diformat IDR/tanggal, untuk layar ringkasan sebelum pembekuan).

- [ ] **Step 1: Failing tests:** satu langkah per field dengan `index` 1..n; setiap field `idr` dan `date` punya `example` dan `help`; `nextMissing` melewati field terisi dan mengembalikan `null` bila lengkap; field wajib hanya spasi dianggap kosong; `progress` 0% saat kosong dan 100% saat lengkap; `summarize` memformat `5000000` → `Rp5.000.000` dan `2026-10-16` → `16 Oktober 2026`, serta menandai field opsional kosong dengan `(tidak diisi)`.
- [ ] **Step 2:** FAIL. **Step 3: Implement.** **Step 4:** PASS. **Step 5: Commit** `feat(documents): interview wizard model`.

### Task 11: Komponen dan halaman (workspace, dokumen, Vault)

**Files:** Create `src/components/documents/{wizard-step,document-preview,version-list}.tsx`, halaman di `src/app/(app)/{workspace/new,workspace/[id],documents,documents/[id],vault}/page.tsx`, `src/app/(app)/documents/actions.ts`, `tests/unit/document-ui.test.ts`.

**Interfaces:** Consumes `buildSteps`, `summarize`, `DocumentsService`. Produces komponen server: `WizardStep({ step, value, error }: {...})`, `DocumentPreview({ doc }: { doc: RenderedDoc })`, `VersionList({ versions }: { versions: VersionRow[] })`; server action `saveStepAction(formData)`, `freezeAction(formData)`, `exportAction(formData)`.

- [ ] **Step 1: Failing tests** (render ke string, tanpa JSX di berkas tes): `WizardStep` memuat label, `Wajib` atau `Opsional`, contoh, `Mengapa informasi ini diperlukan?`, tombol `Kembali` dan `Lanjut`, `<label for>` terhubung ke input, dan `role="alert"` bila ada error; `DocumentPreview` selalu memuat `AI_DRAFT_LABEL`; `VersionList` menampilkan `Versi baru belum diperiksa` untuk setiap versi (tidak ada badge pada fase ini) dan hash 12 karakter pertama; tidak ada kata "cap" di keluaran semua komponen.
- [ ] **Step 2:** FAIL. **Step 3: Implement** halaman: `/workspace/new` (tiga kartu dokumen; membuat dokumen dengan `Idempotency-Key` acak per klik), `/workspace/[id]` (satu pertanyaan per layar, simpan tiap `Lanjut`, ringkasan fakta sebelum `Buat dokumen`, pratinjau, galat kuota dalam kalimat tenang dengan jam reset), `/documents` (dokumen berjalan), `/documents/[id]` (versi, diff dengan versi sebelumnya, ekspor DOCX/PDF, `Buat versi baru dari versi ini`), `/vault` (versi beku dikelompokkan per dokumen; belum ada fitur berbadan). Server action memanggil layanan dengan `userId` dari sesi.
- [ ] **Step 4:** PASS + `npm run build`. **Step 5: Commit** `feat(ui): workspace wizard, documents, vault pages`.

### Task 12: Penyalinan dokumen

**Files:** Create `supabase/migrations/20261016000009_clone.sql`, `tests/db/clone.test.ts`, `src/app/api/documents/versions/[versionId]/clone/route.ts`; Modify `src/lib/documents/service.ts`.

**Interfaces:** Produces fungsi SQL `clone_document(p_user uuid, p_source_version uuid, p_key text) returns uuid` (membuat dokumen baru dengan draf dari `structured_data` versi sumber; tidak mewarisi versi, ekspor, atau badge) dan `DocumentsService.clone(userId: string, versionId: string, key: string): Promise<{ documentId: string } | null>`.

- [ ] **Step 1: Failing tests:** salinan milik sendiri → dokumen baru dengan draf sama dan 0 versi; kunci sama → dokumen yang sama; versi orang lain → `null`; membekukan salinan memakai satu kuota dokumen (Free: setelah dokumen pertama sudah dibekukan, pembekuan salinan → `DOCUMENT_DAILY_QUOTA_REACHED`); versi dokumen sumber tidak berubah.
- [ ] **Step 2:** FAIL. **Step 3: Implement** (handler `cloneHandler` ditambahkan ke `handlers.ts`). **Step 4:** PASS. **Step 5: Commit** `feat(documents): clone consumes a document unit on first freeze`.

### Task 13: Verifikasi akhir dan laporan

**Files:** Modify `README.md` (alur dokumen, env `DOCUMENT_BLOB_DIR`, `ALLOW_UNAPPROVED_TEMPLATES`), `.env.example`, `PACKAGE_MANIFEST.json` (re-baseline file yang berubah).

- [ ] **Step 1:** `npm run check` lalu `npm run build`; catat jumlah tes yang benar-benar jalan. Expected: semua PASS.
- [ ] **Step 2:** Periksa: `grep -rn "canonical_text" supabase/migrations` hanya memuat kolom dan fungsi bertanda `SECURITY DEFINER`; `grep -rniE "\bcap\b" src` tidak memuat salinan UI; `python3 -I scripts/validate_package.py` PASS setelah re-baseline.
- [ ] **Step 3:** Tulis laporan singkat (berkas, cara lokal, tes yang dijalankan dan yang tidak, UNKNOWN yang tersisa: sign-off template, adapter Supabase Storage belum dites, font PDF non-Latin). Jangan klaim E2E atau smoke lulus.
- [ ] **Step 4: Commit** `docs: Phase 2 setup notes and verification` lalu `git push -u origin claude/great-cerf-8hwfjk`.

---

## Self-review (dijalankan)

- **Cakupan spec/blueprint Fase 2:** template dengan model persetujuan (T2, T4–5), wawancara terstruktur satu pertanyaan per layar dengan simpan otomatis dan ringkasan sebelum pembuatan (T10–11), renderer deterministik tanpa fakta karangan (T3), versi tak berubah ber-hash dan sunting membuat versi baru (T4–5), ekspor DOCX/PDF dengan hash tersendiri (T7–8), penyimpanan privat dan RLS lintas pengguna (T4, T7–9), diff (T6), versi baru dari versi lama dan penyalinan (T11–12), Vault dasar (T11), kuota dokumen sesuai AI_FAIR_USAGE (T4–5, T12). Ditunda ke Fase 2b (spec §12): berbagi, paket bukti, pengingat, wawancara berbantuan AI, pemetaan fitur Vault ke plan.
- **Konsistensi tipe:** `Template`, `Data`, `RenderedDoc`, `FreezeResult`, `DocumentsService`, `BlobStore`, nama fungsi SQL dan kode galat konsisten antar-task.
- **Deviasi disengaja:** kuota dokumen dikonsumsi saat pembekuan versi pertama (sesuai `AI_FAIR_USAGE.md`: wawancara dan pratinjau tidak memakai kuota); unduhan lewat rute berotorisasi, bukan signed URL, di fase ini.
- **UNKNOWN yang tidak menghambat:** persetujuan mitra atas klausul dan template, perilaku Supabase Storage sungguhan, font PDF untuk aksara non-Latin, redaksi final label template.

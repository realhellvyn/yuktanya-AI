import { createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createPgUsageStore } from "@/lib/ai/quota";
import { asUser, createUser, getPool } from "./helpers";

const pool = getPool();
afterAll(() => pool.end());
const store = createPgUsageStore(pool);
const NOW = new Date("2026-10-16T05:00:00Z");
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const canon = (n = Math.random()) => JSON.stringify({ blocks: [{ id: "title", text: `Dokumen ${n}` }] });

const createDoc = async (u: string, key = `k-${Math.random()}`) =>
  (await pool.query("select create_document($1, 'NDA', 'nda', 1, 'Judul', $2) as id", [u, key])).rows[0].id as string;
const freeze = async (u: string, doc: string, key: string, canonical = canon()) =>
  (await pool.query("select * from freeze_version($1, $2, $3, $4, $5, $6)", [u, doc, canonical, JSON.stringify({ a: 1 }), key, NOW])).rows[0] as {
    status: string; version_id: string | null; version_no: number | null; sha256: string | null; reset_at: Date;
  };
const versions = async (doc: string) => (await pool.query("select * from document_versions where document_id = $1 order by version_no", [doc])).rows;

describe("create_document", () => {
  it("idempoten per (pemilik, kunci)", async () => {
    const u = await createUser(pool);
    const a = await createDoc(u, "same");
    expect(await createDoc(u, "same")).toBe(a);
  });

  it("batas 20 draf aktif per user", async () => {
    const u = await createUser(pool);
    for (let i = 0; i < 20; i++) await createDoc(u, `d${i}`);
    await expect(createDoc(u, "d21")).rejects.toThrow(/TOO_MANY_DRAFTS/);
  });
});

describe("freeze_version", () => {
  it("versi pertama: CREATED, hash dihitung DB sama dengan SHA-256 byte UTF-8, kuota dokumen 1", async () => {
    const u = await createUser(pool);
    const doc = await createDoc(u);
    const text = JSON.stringify({ nama: "Ñandú \"Ibu\" 日本" });
    const r = await freeze(u, doc, "f1", text);
    expect(r).toMatchObject({ status: "CREATED", version_no: 1, sha256: sha(text) });
    expect((await versions(doc))[0].canonical_text).toBe(text);
    expect((await store.snapshot(u, NOW)).documentsUsed).toBe(1);
  });

  it("Free: dokumen kedua di hari sama → QUOTA_DOCUMENT tanpa versi, draf tetap ada", async () => {
    const u = await createUser(pool);
    await freeze(u, await createDoc(u), "a");
    const second = await createDoc(u);
    const r = await freeze(u, second, "b");
    expect(r.status).toBe("QUOTA_DOCUMENT");
    expect(r.reset_at.toISOString()).toBe("2026-10-16T17:00:00.000Z");
    expect(await versions(second)).toHaveLength(0);
    expect((await pool.query("select 1 from document_drafts where document_id = $1", [second])).rowCount).toBe(1);
  });

  it("versi ke-2 dokumen yang sama tidak memakai kuota", async () => {
    const u = await createUser(pool);
    const doc = await createDoc(u);
    await freeze(u, doc, "v1");
    const r = await freeze(u, doc, "v2");
    expect(r).toMatchObject({ status: "CREATED", version_no: 2 });
    expect((await store.snapshot(u, NOW)).documentsUsed).toBe(1);
  });

  it("kunci sama berurutan → DUPLICATE, satu versi, satu kuota", async () => {
    const u = await createUser(pool);
    const doc = await createDoc(u);
    const a = await freeze(u, doc, "same");
    const b = await freeze(u, doc, "same");
    expect(b.status).toBe("DUPLICATE");
    expect(b.version_id).toBe(a.version_id);
    expect(await versions(doc)).toHaveLength(1);
    expect((await store.snapshot(u, NOW)).documentsUsed).toBe(1);
  });

  it("kunci sama serentak (dua koneksi) → tepat satu versi dan satu kuota", async () => {
    const u = await createUser(pool);
    const doc = await createDoc(u);
    const [a, b] = await Promise.all([freeze(u, doc, "race"), freeze(u, doc, "race")]);
    expect([a.status, b.status].sort()).toEqual(["CREATED", "DUPLICATE"]);
    expect(await versions(doc)).toHaveLength(1);
    expect((await store.snapshot(u, NOW)).documentsUsed).toBe(1);
  });

  it("versi tak berubah: UPDATE/DELETE/TRUNCATE ditolak termasuk untuk superuser", async () => {
    const u = await createUser(pool);
    const doc = await createDoc(u);
    await freeze(u, doc, "imm");
    await expect(pool.query("update document_versions set canonical_text = 'x' where document_id = $1", [doc])).rejects.toThrow(/immutable/);
    await expect(pool.query("delete from document_versions where document_id = $1", [doc])).rejects.toThrow(/immutable/);
    await expect(pool.query("truncate document_versions")).rejects.toThrow(/immutable|cannot truncate/);
  });
});

describe("save_draft", () => {
  it("revisi basi ditolak, revisi benar naik satu", async () => {
    const u = await createUser(pool);
    const doc = await createDoc(u);
    const save = (rev: number) => pool.query("select save_draft($1, $2, $3, $4) as rev", [u, doc, JSON.stringify({ x: rev }), rev]);
    expect((await save(0)).rows[0].rev).toBe(1);
    await expect(save(0)).rejects.toThrow(/STALE_REVISION/);
    expect((await save(1)).rows[0].rev).toBe(2);
  });
});

describe("isolasi antar pengguna", () => {
  it("B tidak dapat menyimpan, membekukan, atau mendaftarkan ekspor atas milik A, dan RLS menyembunyikannya", async () => {
    const a = await createUser(pool);
    const b = await createUser(pool);
    const doc = await createDoc(a);
    const v = await freeze(a, doc, "own");
    await expect(pool.query("select save_draft($1, $2, '{}'::jsonb, 0)", [b, doc])).rejects.toThrow(/NOT_FOUND/);
    await expect(freeze(b, doc, "x")).rejects.toThrow(/NOT_FOUND/);
    await expect(
      pool.query("select register_export($1, $2, 'PDF', $3, 10, $4)", [b, v.version_id, "a".repeat(64), `${b}/${doc}/x.pdf`]),
    ).rejects.toThrow(/NOT_FOUND/);
    const seenByB = await asUser(pool, b, async (c) => (await c.query("select id from documents")).rows);
    expect(seenByB).toEqual([]);
    const seenByA = await asUser(pool, a, async (c) => (await c.query("select id from document_versions")).rows);
    expect(seenByA).toEqual([{ id: v.version_id }]);
  });

  it("authenticated tidak dapat memanggil fungsi atau menulis tabel", async () => {
    const u = await createUser(pool);
    for (const sql of [
      "select create_document(auth.uid(), 'NDA', 'nda', 1, 't', 'k')",
      "select save_draft(auth.uid(), gen_random_uuid(), '{}'::jsonb, 0)",
      "select * from freeze_version(auth.uid(), gen_random_uuid(), 'x', '{}'::jsonb, 'k', now())",
      "insert into documents(owner_id, category, template_id, template_version, title, idempotency_key) values (auth.uid(), 'NDA', 'nda', 1, 't', 'k')",
      "insert into document_versions(document_id, version_no, canonical_text, sha256, structured_data, template_id, template_version, idempotency_key) values (gen_random_uuid(), 1, 'x', repeat('a', 64), '{}', 'nda', 1, 'k')",
    ]) {
      await expect(asUser(pool, u, (c) => c.query(sql))).rejects.toMatchObject({ code: "42501" });
    }
  });
});

describe("register_export", () => {
  it("path harus berawalan {user}/{dokumen}/ dan tanpa '..'; ekspor tidak dapat diubah", async () => {
    const u = await createUser(pool);
    const doc = await createDoc(u);
    const v = await freeze(u, doc, "e");
    const reg = (path: string) => pool.query("select register_export($1, $2, 'DOCX', $3, 100, $4) as id", [u, v.version_id, "d".repeat(64), path]);
    await expect(reg("lain/x.docx")).rejects.toThrow(/INVALID_PATH/);
    await expect(reg(`${u}/${doc}/../x.docx`)).rejects.toThrow(/INVALID_PATH/);
    const id = (await reg(`${u}/${doc}/ok.docx`)).rows[0].id;
    expect(id).toBeTruthy();
    await expect(pool.query("update document_exports set byte_size = 1 where id = $1", [id])).rejects.toThrow(/immutable/);
  });
});

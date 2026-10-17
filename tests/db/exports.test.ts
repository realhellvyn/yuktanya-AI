import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterAll, describe, expect, it } from "vitest";
import { createPgUsageStore } from "@/lib/ai/quota";
import { createFsBlobStore } from "@/lib/documents/blob";
import { sha256Hex } from "@/lib/documents/export";
import { createPgDocumentsService, IntegrityError } from "@/lib/documents/service";
import type { Data } from "@/lib/documents/types";
import { createUser, getPool } from "./helpers";

const pool = getPool();
afterAll(() => pool.end());
const NOW = new Date("2026-10-16T05:00:00Z");
const root = mkdtempSync(path.join(tmpdir(), "exports-"));
const blob = createFsBlobStore(root);
const svc = createPgDocumentsService(pool, { ALLOW_UNAPPROVED_TEMPLATES: "true", NODE_ENV: "test" }, { blob });
const store = createPgUsageStore(pool);
const key = () => `k-${Math.random().toString(36).slice(2)}`;

const data: Data = {
  disclosingParty: "ZZ-PIHAK-SATU", receivingParty: "ZZ-PIHAK-DUA", signingDate: "2026-10-16", confidentialInfo: "ZZ-INFO",
  purpose: "ZZ-TUJUAN", termMonths: 24, disputeCity: "ZZ-KOTA",
};

async function frozen(userId: string) {
  const { documentId } = await svc.create(userId, "NDA", key());
  await svc.saveDraft(userId, documentId, data, 0);
  const r = await svc.freeze(userId, documentId, key(), NOW);
  if (!r.ok) throw new Error("freeze gagal");
  return { documentId, versionId: r.versionId, versionSha: r.sha256 };
}

describe("exportVersion", () => {
  it("menyimpan ekspor dengan hash berkas sendiri (bukan hash versi) di path milik pengguna", async () => {
    const u = await createUser(pool);
    const f = await frozen(u);
    const e = (await svc.exportVersion(u, f.versionId, "PDF"))!;
    const row = (await pool.query("select * from document_exports where id = $1", [e.exportId])).rows[0];
    expect(row.storage_path.startsWith(`${u}/${f.documentId}/`)).toBe(true);
    expect(row.sha256).toBe(e.sha256);
    expect(e.sha256).not.toBe(f.versionSha);
    const stored = (await blob.get(row.storage_path))!;
    expect(sha256Hex(stored)).toBe(row.sha256);
    expect(stored.byteLength).toBe(row.byte_size);
  });

  it("dua ekspor format sama dari versi sama tercatat keduanya; kuota tidak berubah", async () => {
    const u = await createUser(pool);
    const f = await frozen(u);
    const before = await store.snapshot(u, NOW);
    const a = (await svc.exportVersion(u, f.versionId, "DOCX"))!;
    const b = (await svc.exportVersion(u, f.versionId, "DOCX"))!;
    expect(a.exportId).not.toBe(b.exportId);
    expect(await store.snapshot(u, NOW)).toEqual(before);
  });

  it("isi DOCX berasal dari byte kanonik versi", async () => {
    const u = await createUser(pool);
    const f = await frozen(u);
    const e = (await svc.exportVersion(u, f.versionId, "DOCX"))!;
    const d = (await svc.downloadExport(u, e.exportId))!;
    expect(d.contentType).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(d.filename).toMatch(/^[a-z0-9-]+-v1\.docx$/);
    const xml = await (await JSZip.loadAsync(d.bytes)).file("word/document.xml")!.async("string");
    expect(xml).toContain("ZZ-PIHAK-SATU");
  });

  it("pengguna lain: ekspor dan unduh → null", async () => {
    const a = await createUser(pool);
    const b = await createUser(pool);
    const f = await frozen(a);
    const e = (await svc.exportVersion(a, f.versionId, "PDF"))!;
    expect(await svc.exportVersion(b, f.versionId, "PDF")).toBeNull();
    expect(await svc.downloadExport(b, e.exportId)).toBeNull();
    expect(await svc.downloadExport(a, e.exportId)).not.toBeNull();
  });

  it("berkas di blob diubah → IntegrityError; berkas hilang → IntegrityError", async () => {
    const u = await createUser(pool);
    const f = await frozen(u);
    const e = (await svc.exportVersion(u, f.versionId, "PDF"))!;
    const p = (await pool.query("select storage_path from document_exports where id = $1", [e.exportId])).rows[0].storage_path;
    writeFileSync(path.join(root, p), "dimodifikasi");
    await expect(svc.downloadExport(u, e.exportId)).rejects.toBeInstanceOf(IntegrityError);

    // Berkas hilang: baris ekspor ada, tetapi blob tidak pernah ditulis.
    await pool.query("insert into document_exports(version_id, format, sha256, byte_size, storage_path) values ($1, 'PDF', $2, 10, $3)", [f.versionId, "e".repeat(64), `${u}/${f.documentId}/hilang.pdf`]);
    const id = (await pool.query("select id from document_exports where storage_path = $1", [`${u}/${f.documentId}/hilang.pdf`])).rows[0].id;
    await expect(svc.downloadExport(u, id)).rejects.toBeInstanceOf(IntegrityError);
  });
});

describe("exportVersion dengan verifikasi", () => {
  async function withAi(u: string, versionId: string, versionSha: string) {
    const rep = (await pool.query("insert into ai_review_reports (user_id, logical_request_id, version_ref, sha256, report_json, analyzer_policy_version) values ($1, gen_random_uuid(), $2, $3, '{}', 'p1') returning id", [u, versionId, versionSha])).rows[0].id;
    // Rekaman AI ditulis langsung pada versi template (bentuk rekaman lama): sejak migrasi 41 issue_ai_verification hanya
    // menerbitkan untuk dokumen unggahan; yang diuji di sini adalah blok verifikasi di berkas ekspor.
    const code = `AIEXP${Math.random().toString(36).slice(2)}`.padEnd(48, "x");
    return (await pool.query("insert into document_verifications (kind, version_id, sha256, outcome, policy_version, code, ai_report_id, issued_at) values ('AI', $1, $2, 'COMPLETED', 'p1', $3, $4, $5) returning id as verification_id, code", [versionId, versionSha, code, rep, NOW])).rows[0] as { verification_id: string; code: string };
  }
  const xmlOf = async (u: string, versionId: string) => {
    const e = (await svc.exportVersion(u, versionId, "DOCX"))!;
    const row = (await pool.query("select storage_path from document_exports where id = $1", [e.exportId])).rows[0];
    return { xml: await (await JSZip.loadAsync((await blob.get(row.storage_path))!)).file("word/document.xml")!.async("string"), sha: e.sha256 };
  };

  it("versi tanpa verifikasi → tanpa blok; dengan verifikasi aktif → blok memuat kode dan hash ekspor tetap tersendiri; dicabut → blok hilang", async () => {
    const u = await createUser(pool);
    const f = await frozen(u);
    expect((await xmlOf(u, f.versionId)).xml).not.toContain("Kode versi asli");
    const v = await withAi(u, f.versionId, f.versionSha);
    const withBlock = await xmlOf(u, f.versionId);
    expect(withBlock.xml).toContain(v.code);
    expect(withBlock.xml).toContain(`Kode versi asli: ${f.versionSha}`);
    expect(withBlock.sha).not.toBe(f.versionSha);
    const admin = await createUser(pool, { roles: ["platform_admin"] });
    await pool.query("select revoke_verification($1, $2, 'ERROR', null, $3)", [admin, v.verification_id, NOW]);
    expect((await xmlOf(u, f.versionId)).xml).not.toContain(v.code);
  });
});

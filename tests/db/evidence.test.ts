import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import JSZip from "jszip";
import { afterAll, describe, expect, it } from "vitest";
import { createFsBlobStore } from "@/lib/documents/blob";
import { createPgDocumentsService, IntegrityError } from "@/lib/documents/service";
import type { Data } from "@/lib/documents/types";
import { buildEvidencePack, downloadEvidencePack, RateLimitedError } from "@/lib/vault/evidence";
import { FeatureNotAvailableError } from "@/lib/vault/features";
import { createMockEmailSender, processOutbox } from "@/lib/vault/outbox";
import { createPgShareService, hashToken } from "@/lib/vault/share";
import { createUser, getPool } from "./helpers";

const pool = getPool();
afterAll(() => pool.end());
const T0 = new Date("2026-10-16T05:00:00Z");
const root = mkdtempSync(path.join(tmpdir(), "evidence-"));
const blob = createFsBlobStore(root);
const docs = createPgDocumentsService(pool, { ALLOW_UNAPPROVED_TEMPLATES: "true", NODE_ENV: "test" }, { blob });
const shares = createPgShareService(pool);
const deps = { pool, blob };
const key = () => `k-${Math.random().toString(36).slice(2)}-abcdef`;
const data: Data = {
  disclosingParty: "Sinta Dewi", receivingParty: "Budi Santoso", signingDate: "2026-10-16", confidentialInfo: "ZZ-INFO",
  purpose: "Evaluasi", termMonths: 24, disputeCity: "Jakarta",
};
const sha = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");

async function member(withVersion = true) {
  const u = await createUser(pool);
  await pool.query("insert into memberships(user_id, status, period_start, period_end) values ($1, 'ACTIVE', '2026-10-01', '2026-11-01')", [u]);
  const { documentId } = await docs.create(u, "NDA", key());
  let versionId: string | undefined;
  if (withVersion) {
    await docs.saveDraft(u, documentId, data, 0);
    const r = await docs.freeze(u, documentId, key(), T0);
    if (!r.ok) throw new Error("freeze gagal");
    versionId = r.versionId;
  }
  return { u, documentId, versionId };
}
const open = async (bytes: Uint8Array) => JSZip.loadAsync(bytes);
const read = async (z: JSZip, p: string) => z.file(p)!.async("string");

describe("paket bukti", () => {
  it("memuat berkas yang dijanjikan; manifest cocok dengan isi tiap berkas; hash paket sama dengan hash blob", async () => {
    const m = await member();
    await docs.exportVersion(m.u, m.versionId!, "PDF");
    const share = await shares.create(m.u, m.versionId!, 48 * 3600, T0);
    await shares.resolve(share.token, T0);
    const to = "pihak@example.test";
    await shares.requestAck(share.token, to, T0);
    const sender = createMockEmailSender();
    await processOutbox(pool, sender, T0, 1000);
    await shares.verifyAck(share.token, to, /\b(\d{6})\b/.exec(sender.sent.find((x) => x.to === to)!.text)![1], T0);

    const pack = (await buildEvidencePack(deps, m.u, m.documentId, T0))!;
    const stored = (await blob.get((await pool.query("select storage_path from evidence_packs where id = $1", [pack.packId])).rows[0].storage_path))!;
    expect(sha(stored)).toBe(pack.sha256);
    const z = await open(stored);
    expect(Object.keys(z.files).sort()).toEqual(["README.txt", "exports.json", "history.json", "manifest.json", "shares.json", "versions/v1.json"]);

    const manifest = JSON.parse(await read(z, "manifest.json"));
    expect(manifest.schema).toBe(1);
    for (const f of manifest.files as { path: string; sha256: string; bytes: number }[]) {
      const content = await z.file(f.path)!.async("uint8array");
      expect(sha(content)).toBe(f.sha256);
      expect(content.byteLength).toBe(f.bytes);
    }
    expect((manifest.files as { path: string }[]).map((f) => f.path)).not.toContain("manifest.json");

    const v = JSON.parse(await read(z, "versions/v1.json"));
    const row = (await pool.query("select canonical_text, sha256 from document_versions where id = $1", [m.versionId])).rows[0];
    expect(v.canonicalText).toBe(row.canonical_text);
    expect(v.sha256).toBe(row.sha256);

    const sh = JSON.parse(await read(z, "shares.json"));
    expect(sh.links[0]).toMatchObject({ versionNo: 1, openedCount: 1 });
    expect(sh.acknowledgements).toMatchObject([{ versionNo: 1, email: to }]);
    const ex = JSON.parse(await read(z, "exports.json"));
    expect(ex[0]).toMatchObject({ versionNo: 1, format: "PDF" });
    expect(JSON.stringify(ex)).not.toContain(m.u);
  });

  it("README memuat pernyataan wajib dan tanpa kata 'cap'; tidak ada token atau hash token di dalam paket", async () => {
    const m = await member();
    const share = await shares.create(m.u, m.versionId!, 48 * 3600, T0);
    const pack = (await buildEvidencePack(deps, m.u, m.documentId, T0))!;
    const z = await open((await downloadEvidencePack(deps, m.u, pack.packId))!.bytes);
    const readme = await read(z, "README.txt");
    expect(readme).toContain("kumpulan catatan sistem");
    expect(readme).toContain("bukan jaminan nilai pembuktian di pengadilan");
    expect(readme).not.toMatch(/\bcap\b/i);
    for (const name of Object.keys(z.files)) {
      const text = await read(z, name);
      expect(text).not.toContain(share.token);
      expect(text).not.toContain(hashToken(share.token));
    }
  });

  it("dokumen tanpa versi menghasilkan paket valid dengan daftar versi kosong", async () => {
    const m = await member(false);
    const pack = (await buildEvidencePack(deps, m.u, m.documentId, T0))!;
    const z = await open((await downloadEvidencePack(deps, m.u, pack.packId))!.bytes);
    expect(JSON.parse(await read(z, "history.json")).versions).toEqual([]);
  });

  it("milik orang lain → null; tanpa fitur → FeatureNotAvailable; kedua dalam 60 detik → RateLimited", async () => {
    const m = await member();
    const other = await createUser(pool);
    expect(await buildEvidencePack(deps, other, m.documentId, T0)).toBeNull();
    const free = await createUser(pool);
    const { documentId } = await docs.create(free, "NDA", key());
    await expect(buildEvidencePack(deps, free, documentId, T0)).rejects.toBeInstanceOf(FeatureNotAvailableError);
    const first = await buildEvidencePack(deps, m.u, m.documentId, T0);
    expect(first).not.toBeNull();
    await expect(buildEvidencePack(deps, m.u, m.documentId, new Date(T0.getTime() + 30_000))).rejects.toBeInstanceOf(RateLimitedError);
    await expect(buildEvidencePack(deps, m.u, m.documentId, new Date(T0.getTime() + 61_000))).resolves.not.toBeNull();
    const pack = first!;
    expect(await downloadEvidencePack(deps, other, pack.packId)).toBeNull();
  });

  it("berkas blob diubah → IntegrityError", async () => {
    const m = await member();
    const pack = (await buildEvidencePack(deps, m.u, m.documentId, T0))!;
    const p = (await pool.query("select storage_path from evidence_packs where id = $1", [pack.packId])).rows[0].storage_path;
    writeFileSync(path.join(root, p), "dimodifikasi");
    await expect(downloadEvidencePack(deps, m.u, pack.packId)).rejects.toBeInstanceOf(IntegrityError);
  });
});

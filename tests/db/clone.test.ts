import { afterAll, describe, expect, it } from "vitest";
import { cloneHandler } from "@/lib/documents/handlers";
import { createPgDocumentsService } from "@/lib/documents/service";
import type { Data } from "@/lib/documents/types";
import { createUser, getPool } from "./helpers";

const pool = getPool();
afterAll(() => pool.end());
const NOW = new Date("2026-10-16T05:00:00Z");
const svc = createPgDocumentsService(pool, { ALLOW_UNAPPROVED_TEMPLATES: "true", NODE_ENV: "test" });
const key = () => `k-${Math.random().toString(36).slice(2)}-abcdef`;
const data: Data = {
  disclosingParty: "Sinta Dewi", receivingParty: "Budi Santoso", signingDate: "2026-10-16", confidentialInfo: "Info",
  purpose: "Tujuan", termMonths: 24, disputeCity: "Jakarta",
};

async function frozen(userId: string) {
  const { documentId } = await svc.create(userId, "NDA", key());
  await svc.saveDraft(userId, documentId, data, 0);
  const r = await svc.freeze(userId, documentId, key(), NOW);
  if (!r.ok) throw new Error("freeze gagal");
  return { documentId, versionId: r.versionId };
}

describe("clone", () => {
  it("menyalin draf ke dokumen baru tanpa versi; sumber tidak berubah", async () => {
    const u = await createUser(pool);
    const src = await frozen(u);
    const c = (await svc.clone(u, src.versionId, key()))!;
    expect(c.documentId).not.toBe(src.documentId);
    const copy = (await svc.get(u, c.documentId))!;
    expect(copy.versions).toHaveLength(0);
    expect(copy.draft.data).toEqual(data);
    expect((await svc.get(u, src.documentId))!.versions).toHaveLength(1);
  });

  it("kunci sama → dokumen yang sama dan draf yang sudah disunting tidak ditimpa", async () => {
    const u = await createUser(pool);
    const src = await frozen(u);
    const k = key();
    const a = (await svc.clone(u, src.versionId, k))!;
    const edited = (await svc.get(u, a.documentId))!;
    await svc.saveDraft(u, a.documentId, { ...data, termMonths: 36 }, edited.draft.revision);
    const b = (await svc.clone(u, src.versionId, k))!;
    expect(b.documentId).toBe(a.documentId);
    expect((await svc.get(u, a.documentId))!.draft.data.termMonths).toBe(36);
  });

  it("versi milik orang lain → null", async () => {
    const a = await createUser(pool);
    const b = await createUser(pool);
    const src = await frozen(a);
    expect(await svc.clone(b, src.versionId, key())).toBeNull();
  });

  it("membekukan salinan memakai satu kuota dokumen (Free: sudah habis oleh dokumen pertama)", async () => {
    const u = await createUser(pool);
    const src = await frozen(u);
    const c = (await svc.clone(u, src.versionId, key()))!;
    expect(await svc.freeze(u, c.documentId, key(), NOW)).toMatchObject({ ok: false, code: "DOCUMENT_DAILY_QUOTA_REACHED" });
  });
});

describe("cloneHandler", () => {
  const call = (userId: string | null, versionId: string, k: string | null) =>
    cloneHandler(
      { getUserId: async () => userId, service: svc },
      new Request("http://t/x", { method: "POST", headers: k ? { "idempotency-key": k } : {} }),
      { versionId },
    );

  it("anonim 401, tanpa kunci 400, ID orang lain sama dengan ID acak (404), sukses 201", async () => {
    const a = await createUser(pool);
    const b = await createUser(pool);
    const src = await frozen(a);
    expect((await call(null, src.versionId, key())).status).toBe(401);
    expect((await call(a, src.versionId, null)).status).toBe(400);
    const other = await call(b, src.versionId, key());
    const random = await call(b, crypto.randomUUID(), key());
    expect(other.status).toBe(404);
    expect(await other.json()).toEqual(await random.json());
    const ok = await call(a, src.versionId, key());
    expect(ok.status).toBe(201);
    expect(await ok.json()).toHaveProperty("documentId");
  });
});

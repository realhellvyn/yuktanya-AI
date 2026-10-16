import { afterAll, describe, expect, it } from "vitest";
import { canonicalize, renderDocument } from "@/lib/documents/render";
import { createPgDocumentsService, NotFoundError, StaleRevisionError } from "@/lib/documents/service";
import { TemplateNotApprovedError } from "@/lib/documents/templates/registry";
import { nda } from "@/lib/documents/templates/nda";
import { createPgUsageStore } from "@/lib/ai/quota";
import type { Data } from "@/lib/documents/types";
import { createUser, getPool } from "./helpers";
import { createHash } from "node:crypto";

const pool = getPool();
afterAll(() => pool.end());
const NOW = new Date("2026-10-16T05:00:00Z");
const store = createPgUsageStore(pool);

const ndaData: Data = {
  disclosingParty: "Sinta Dewi", receivingParty: "Budi Santoso", signingDate: "2026-10-16", confidentialInfo: "Daftar pelanggan sintetis",
  purpose: "Evaluasi kerja sama", termMonths: 24, disputeCity: "Jakarta Selatan",
};

const dev = createPgDocumentsService(pool, { ALLOW_UNAPPROVED_TEMPLATES: "true", NODE_ENV: "test" });
const prod = (approved: boolean) =>
  createPgDocumentsService(pool, { ALLOW_UNAPPROVED_TEMPLATES: "true", NODE_ENV: "production" }, { isApproved: async () => approved });
const key = () => `k-${Math.random().toString(36).slice(2)}`;

async function draftDoc(userId: string, data: Data = ndaData) {
  const { documentId } = await dev.create(userId, "NDA", key());
  const { revision } = await dev.saveDraft(userId, documentId, data, 0);
  return { documentId, revision };
}

describe("pintu persetujuan template", () => {
  it("produksi tanpa persetujuan: create ditolak; template ditarik setelah draf dibuat → freeze TEMPLATE_NOT_APPROVED tanpa kuota", async () => {
    const u = await createUser(pool);
    await expect(prod(false).create(u, "NDA", key())).rejects.toBeInstanceOf(TemplateNotApprovedError);
    const { documentId } = await draftDoc(u);
    expect(await prod(false).freeze(u, documentId, key(), NOW)).toEqual({ ok: false, code: "TEMPLATE_NOT_APPROVED" });
    expect((await store.snapshot(u, NOW)).documentsUsed).toBe(0);
    expect((await dev.get(u, documentId))!.versions).toHaveLength(0);
  });

  it("produksi dengan persetujuan lolos dan tanpa pemberitahuan DRAFT; ALLOW tidak berlaku di produksi", async () => {
    const u = await createUser(pool);
    const { documentId } = await draftDoc(u);
    const r = await prod(true).freeze(u, documentId, key(), NOW);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const v = (await dev.getVersion(u, r.versionId))!;
      expect(v.doc.approval).toBe("APPROVED");
      expect(v.canonicalText).not.toContain("Template belum disetujui mitra hukum");
    }
  });

  it("non-produksi dengan ALLOW=true memakai DRAFT dan memberi pemberitahuan; tanpa ALLOW ditolak", async () => {
    const u = await createUser(pool);
    const { documentId } = await draftDoc(u);
    const r = await dev.freeze(u, documentId, key(), NOW);
    expect(r.ok).toBe(true);
    if (r.ok) expect((await dev.getVersion(u, r.versionId))!.canonicalText).toContain("Template belum disetujui mitra hukum");
    const strict = createPgDocumentsService(pool, { NODE_ENV: "test" }, { isApproved: async () => false });
    await expect(strict.create(u, "NDA", key())).rejects.toBeInstanceOf(TemplateNotApprovedError);
  });
});

describe("pembekuan", () => {
  it("data tidak valid → VALIDATION_FAILED dengan key field; tanpa versi, tanpa kuota, draf utuh", async () => {
    const u = await createUser(pool);
    const { documentId } = await draftDoc(u, { ...ndaData, receivingParty: "   ", termMonths: -3 });
    const r = await dev.freeze(u, documentId, key(), NOW);
    expect(r.ok).toBe(false);
    if (!r.ok && r.code === "VALIDATION_FAILED") expect(Object.keys(r.errors).sort()).toEqual(["receivingParty", "termMonths"]);
    expect((await dev.get(u, documentId))!.versions).toHaveLength(0);
    expect((await dev.get(u, documentId))!.draft.data.disclosingParty).toBe("Sinta Dewi");
    expect((await store.snapshot(u, NOW)).documentsUsed).toBe(0);
  });

  it("data valid → sha256 sama dengan hash byte kanonik hasil render", async () => {
    const u = await createUser(pool);
    const { documentId } = await draftDoc(u);
    const r = await dev.freeze(u, documentId, key(), NOW);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const expected = createHash("sha256").update(canonicalize(renderDocument(nda, ndaData, "DRAFT")), "utf8").digest("hex");
      expect(r.sha256).toBe(expected);
      expect(r).toMatchObject({ versionNo: 1, duplicate: false });
    }
  });

  it("sunting setelah beku membuat versi baru; byte versi 1 tidak berubah dan kuota tetap 1", async () => {
    const u = await createUser(pool);
    const { documentId, revision } = await draftDoc(u);
    const first = await dev.freeze(u, documentId, key(), NOW);
    if (!first.ok) throw new Error("freeze gagal");
    const before = (await dev.getVersion(u, first.versionId))!.canonicalText;
    await dev.saveDraft(u, documentId, { ...ndaData, termMonths: 36 }, revision);
    const second = await dev.freeze(u, documentId, key(), NOW);
    expect(second).toMatchObject({ ok: true, versionNo: 2 });
    expect((await dev.getVersion(u, first.versionId))!.canonicalText).toBe(before);
    if (second.ok) expect(second.sha256).not.toBe(first.sha256);
    expect((await store.snapshot(u, NOW)).documentsUsed).toBe(1);
  });

  it("Free: dokumen kedua di hari sama → DOCUMENT_DAILY_QUOTA_REACHED dengan resetAt WIB; draf masih terbaca", async () => {
    const u = await createUser(pool);
    await dev.freeze(u, (await draftDoc(u)).documentId, key(), NOW);
    const second = await draftDoc(u);
    expect(await dev.freeze(u, second.documentId, key(), NOW)).toEqual({
      ok: false, code: "DOCUMENT_DAILY_QUOTA_REACHED", resetAt: "2026-10-16T17:00:00.000Z",
    });
    expect((await dev.get(u, second.documentId))!.draft.data.disclosingParty).toBe("Sinta Dewi");
  });

  it("kunci idempoten sama → duplicate: true dan satu versi", async () => {
    const u = await createUser(pool);
    const { documentId } = await draftDoc(u);
    const k = key();
    const a = await dev.freeze(u, documentId, k, NOW);
    const b = await dev.freeze(u, documentId, k, NOW);
    expect(b).toMatchObject({ ok: true, duplicate: true });
    if (a.ok && b.ok) expect(b.versionId).toBe(a.versionId);
  });
});

describe("draf dan isolasi", () => {
  it("saveDraft membuang kunci di luar skema dan nilai non-primitif; revisi basi ditolak", async () => {
    const u = await createUser(pool);
    const { documentId } = await dev.create(u, "NDA", key());
    await dev.saveDraft(u, documentId, { disclosingParty: "A", evil: "x", nested: { a: 1 } } as unknown as Data, 0);
    const d = (await dev.get(u, documentId))!;
    expect(d.draft.data).toEqual({ disclosingParty: "A" });
    await expect(dev.saveDraft(u, documentId, { disclosingParty: "B" }, 0)).rejects.toBeInstanceOf(StaleRevisionError);
  });

  it("pengguna lain: get/getVersion → null; saveDraft/freeze → NotFoundError; list tidak memuat milik orang lain", async () => {
    const a = await createUser(pool);
    const b = await createUser(pool);
    const { documentId } = await draftDoc(a);
    const r = await dev.freeze(a, documentId, key(), NOW);
    if (!r.ok) throw new Error("freeze gagal");
    expect(await dev.get(b, documentId)).toBeNull();
    expect(await dev.getVersion(b, r.versionId)).toBeNull();
    await expect(dev.saveDraft(b, documentId, ndaData, 0)).rejects.toBeInstanceOf(NotFoundError);
    await expect(dev.freeze(b, documentId, key(), NOW)).rejects.toBeInstanceOf(NotFoundError);
    expect(await dev.list(b)).toEqual([]);
    expect((await dev.list(a)).map((x) => x.id)).toEqual([documentId]);
  });
});

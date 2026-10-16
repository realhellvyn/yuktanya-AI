import { afterAll, describe, expect, it } from "vitest";
import { createPgDocumentsService } from "@/lib/documents/service";
import { FeatureNotAvailableError } from "@/lib/vault/features";
import { createPgShareService, InvalidExpiryError } from "@/lib/vault/share";
import { NotFoundError } from "@/lib/documents/service";
import type { Data } from "@/lib/documents/types";
import { asUser, createUser, getPool } from "./helpers";

const pool = getPool();
afterAll(() => pool.end());
const NOW = new Date("2026-10-16T05:00:00Z");
const docs = createPgDocumentsService(pool, { ALLOW_UNAPPROVED_TEMPLATES: "true", NODE_ENV: "test" });
const shares = createPgShareService(pool);
const key = () => `k-${Math.random().toString(36).slice(2)}-abcdef`;
const data: Data = {
  disclosingParty: "Sinta Dewi", receivingParty: "Budi Santoso", signingDate: "2026-10-16", confidentialInfo: "ZZ-RAHASIA",
  purpose: "Evaluasi", termMonths: 24, disputeCity: "Jakarta",
};

async function member() {
  const u = await createUser(pool);
  await pool.query("insert into memberships(user_id, status, period_start, period_end) values ($1, 'ACTIVE', '2026-10-01', '2026-11-01')", [u]);
  return u;
}
async function frozen(u: string, d: Data = data) {
  const { documentId } = await docs.create(u, "NDA", key());
  const detail = (await docs.get(u, documentId))!;
  await docs.saveDraft(u, documentId, d, detail.draft.revision);
  const r = await docs.freeze(u, documentId, key(), NOW);
  if (!r.ok) throw new Error("freeze gagal");
  return { documentId, versionId: r.versionId };
}
const HOUR = 3600;

describe("berbagi versi", () => {
  it("create menghasilkan token 43 karakter dan DB hanya menyimpan hash-nya", async () => {
    const u = await member();
    const v = await frozen(u);
    const { token, shareId } = await shares.create(u, v.versionId, 24 * HOUR, NOW);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const row = (await pool.query("select * from share_links where id = $1", [shareId])).rows[0];
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(token);
  });

  it("Free tanpa fitur → FeatureNotAvailable; versi orang lain → NotFound", async () => {
    const free = await createUser(pool);
    const owner = await member();
    const v = await frozen(owner);
    const fv = await frozen(free);
    await expect(shares.create(free, fv.versionId, HOUR, NOW)).rejects.toBeInstanceOf(FeatureNotAvailableError);
    const other = await member();
    await expect(shares.create(other, v.versionId, HOUR, NOW)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("TTL kurang dari 1 jam atau lebih dari 30 hari ditolak", async () => {
    const u = await member();
    const v = await frozen(u);
    await expect(shares.create(u, v.versionId, HOUR - 1, NOW)).rejects.toBeInstanceOf(InvalidExpiryError);
    await expect(shares.create(u, v.versionId, 30 * 24 * HOUR + 1, NOW)).rejects.toBeInstanceOf(InvalidExpiryError);
    await expect(shares.create(u, v.versionId, 30 * 24 * HOUR, NOW)).resolves.toBeTruthy();
  });

  it("resolve: token benar → OK dengan isi versi; token salah → NOT_FOUND tanpa isi", async () => {
    const u = await member();
    const v = await frozen(u);
    const { token } = await shares.create(u, v.versionId, 24 * HOUR, NOW);
    const ok = await shares.resolve(token, NOW);
    expect(ok.status).toBe("OK");
    if (ok.status === "OK") {
      expect(ok.versionNo).toBe(1);
      expect(ok.doc.blocks.some((b) => b.text.includes("ZZ-RAHASIA"))).toBe(true);
      expect(Object.keys(ok).sort()).toEqual(["doc", "hasNewer", "sha256", "status", "title", "versionNo"]);
    }
    expect(await shares.resolve("x".repeat(43), NOW)).toEqual({ status: "NOT_FOUND" });
    expect(await shares.resolve("pendek", NOW)).toEqual({ status: "NOT_FOUND" });
  });

  it("kedaluwarsa → EXPIRED tanpa isi; dicabut → REVOKED seketika", async () => {
    const u = await member();
    const v = await frozen(u);
    const a = await shares.create(u, v.versionId, HOUR, NOW);
    expect(await shares.resolve(a.token, new Date(NOW.getTime() + HOUR * 1000))).toEqual({ status: "EXPIRED" });
    const b = await shares.create(u, v.versionId, 24 * HOUR, NOW);
    expect((await shares.resolve(b.token, NOW)).status).toBe("OK");
    await shares.revoke(u, b.shareId, NOW);
    expect(await shares.resolve(b.token, NOW)).toEqual({ status: "REVOKED" });
  });

  it("revoke oleh orang lain → NotFound", async () => {
    const u = await member();
    const v = await frozen(u);
    const { shareId } = await shares.create(u, v.versionId, 24 * HOUR, NOW);
    const other = await createUser(pool);
    await expect(shares.revoke(other, shareId, NOW)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("versi baru tidak mengubah isi link lama; hasNewer menjadi true", async () => {
    const u = await member();
    const v = await frozen(u);
    const { token } = await shares.create(u, v.versionId, 24 * HOUR, NOW);
    const detail = (await docs.get(u, v.documentId))!;
    await docs.saveDraft(u, v.documentId, { ...data, confidentialInfo: "ZZ-BARU" }, detail.draft.revision);
    await docs.freeze(u, v.documentId, key(), NOW);
    const view = await shares.resolve(token, NOW);
    expect(view.status).toBe("OK");
    if (view.status === "OK") {
      expect(view.hasNewer).toBe(true);
      expect(view.doc.blocks.some((b) => b.text.includes("ZZ-RAHASIA"))).toBe(true);
      expect(view.doc.blocks.some((b) => b.text.includes("ZZ-BARU"))).toBe(false);
    }
  });

  it("list menghitung pembukaan; authenticated tidak dapat memanggil fungsi publik", async () => {
    const u = await member();
    const v = await frozen(u);
    const { token } = await shares.create(u, v.versionId, 24 * HOUR, NOW);
    await shares.resolve(token, NOW);
    await shares.resolve(token, NOW);
    expect((await shares.list(u, v.versionId))[0]).toMatchObject({ openedCount: 2, revokedAt: null });
    await expect(asUser(pool, u, (c) => c.query("select * from resolve_share(repeat('a', 64), now())"))).rejects.toMatchObject({ code: "42501" });
  });
});

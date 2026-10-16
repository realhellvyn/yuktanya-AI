import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createFsBlobStore } from "@/lib/documents/blob";
import { ForbiddenError } from "@/lib/documents/handlers";
import { createPgDocumentsService } from "@/lib/documents/service";
import type { Data } from "@/lib/documents/types";
import { buildEvidencePack } from "@/lib/vault/evidence";
import { evidenceDownloadHandler, outboxJobHandler } from "@/lib/vault/handlers";
import { createMockEmailSender } from "@/lib/vault/outbox";
import { createUser, getPool } from "./helpers";

const pool = getPool();
afterAll(() => pool.end());
const T0 = new Date();
const blob = createFsBlobStore(mkdtempSync(path.join(tmpdir(), "jobs-")));
const docs = createPgDocumentsService(pool, { ALLOW_UNAPPROVED_TEMPLATES: "true", NODE_ENV: "test" }, { blob });
const key = () => `k-${Math.random().toString(36).slice(2)}-abcdef`;
const data: Data = {
  disclosingParty: "Sinta Dewi", receivingParty: "Budi Santoso", signingDate: "2026-10-16", confidentialInfo: "Info",
  purpose: "Tujuan", termMonths: 24, disputeCity: "Jakarta",
};

describe("outboxJobHandler", () => {
  const call = (secret: string | undefined, header: string | null, sender: ReturnType<typeof createMockEmailSender> | null) =>
    outboxJobHandler({ pool, sender, secret }, new Request("http://t/x", { method: "POST", headers: header ? { authorization: header } : {} }));

  it("tanpa rahasia terkonfigurasi → 503; tanpa pengirim → 503; header salah/hilang → 401", async () => {
    const s = createMockEmailSender();
    expect((await call(undefined, "Bearer x", s)).status).toBe(503);
    expect((await call("rahasia-panjang-123", "Bearer rahasia-panjang-123", null)).status).toBe(503);
    expect((await call("rahasia-panjang-123", null, s)).status).toBe(401);
    expect((await call("rahasia-panjang-123", "Bearer salah", s)).status).toBe(401);
    expect((await call("rahasia-panjang-123", "Bearer rahasia-panjang-12", s)).status).toBe(401);
  });

  it("rahasia benar → memproses outbox dan mengembalikan jumlah", async () => {
    const res = await call("rahasia-panjang-123", "Bearer rahasia-panjang-123", createMockEmailSender());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ sent: expect.any(Number), failed: expect.any(Number) });
  });
});

describe("evidenceDownloadHandler", () => {
  async function pack() {
    const u = await createUser(pool);
    await pool.query("insert into memberships(user_id, status, period_start, period_end) values ($1, 'ACTIVE', now() - interval '1 day', now() + interval '30 days')", [u]);
    const { documentId } = await docs.create(u, "NDA", key());
    await docs.saveDraft(u, documentId, data, 0);
    const p = (await buildEvidencePack({ pool, blob }, u, documentId, T0))!;
    return { u, packId: p.packId };
  }
  const call = (userId: string | null | "forbidden", packId: string) =>
    evidenceDownloadHandler(
      { getUserId: async () => { if (userId === "forbidden") throw new ForbiddenError(); return userId; }, pool, blob },
      new Request("http://t/x"),
      { packId },
    );

  it("401 anonim, 403 non-pemilik, 404 milik orang lain atau bukan uuid, 200 dengan header aman untuk pemilik", async () => {
    const { u, packId } = await pack();
    expect((await call(null, packId)).status).toBe(401);
    expect((await call("forbidden", packId)).status).toBe(403);
    const other = await createUser(pool);
    const mine = await call(other, packId);
    const random = await call(other, crypto.randomUUID());
    expect(mine.status).toBe(404);
    expect(await mine.json()).toEqual(await random.json());
    expect((await call(u, "bukan-uuid")).status).toBe(404);
    const ok = await call(u, packId);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("application/zip");
    expect(ok.headers.get("content-disposition")).toMatch(/^attachment; filename="bukti-[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.zip"$/);
    expect(ok.headers.get("cache-control")).toBe("private, no-store");
    expect(ok.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

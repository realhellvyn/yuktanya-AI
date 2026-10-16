import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createPgUsageStore } from "@/lib/ai/quota";
import { createFsBlobStore } from "@/lib/documents/blob";
import * as H from "@/lib/documents/handlers";
import { createPgDocumentsService, type DocumentsService } from "@/lib/documents/service";
import type { Data } from "@/lib/documents/types";
import { createUser, getPool } from "./helpers";

const pool = getPool();
afterAll(() => pool.end());
const NOW = new Date("2026-10-16T05:00:00Z");
const blob = createFsBlobStore(mkdtempSync(path.join(tmpdir(), "handlers-")));
const service = createPgDocumentsService(pool, { ALLOW_UNAPPROVED_TEMPLATES: "true", NODE_ENV: "test" }, { blob });
const store = createPgUsageStore(pool);
const data: Data = {
  disclosingParty: "Sinta Dewi", receivingParty: "Budi Santoso", signingDate: "2026-10-16", confidentialInfo: "Info sintetis",
  purpose: "Evaluasi", termMonths: 24, disputeCity: "Jakarta",
};
const uuid = () => crypto.randomUUID();
const idem = () => `key-${Math.random().toString(36).slice(2)}-abcdef`;

type Call = { key?: string | null; body?: unknown; query?: string; headers?: Record<string, string> };
async function call(h: (d: H.DocDeps, r: Request, p?: Record<string, string>) => Promise<Response>, userId: string | null, params: Record<string, string> = {}, o: Call = {}, svc: DocumentsService = service) {
  const headers: Record<string, string> = { "content-type": "application/json", ...(o.headers ?? {}) };
  if (o.key !== null && o.key !== undefined) headers["idempotency-key"] = o.key;
  const req = new Request(`http://t/api/x${o.query ?? ""}`, { method: o.body === undefined ? "GET" : "POST", headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  return h({ getUserId: async () => userId, service: svc, now: () => NOW }, req, params);
}
const json = async (r: Response) => r.json();

async function newDoc(u: string, fill: Data = data) {
  const created = await json(await call(H.createDocumentHandler, u, {}, { key: idem(), body: { category: "NDA" } }));
  await service.saveDraft(u, created.documentId, fill, 0);
  return created.documentId as string;
}
async function frozen(u: string) {
  const id = await newDoc(u);
  const r = await call(H.freezeHandler, u, { id }, { key: idem(), body: {} });
  return { id, ...(await json(r)) } as { id: string; versionId: string; sha256: string; versionNo: number };
}

const never = new Proxy({}, { get: () => () => { throw new Error("service dipanggil"); } }) as DocumentsService;

describe("autentikasi", () => {
  it("anonim di setiap handler → 401 dan service tidak dipanggil", async () => {
    const all = [H.createDocumentHandler, H.listDocumentsHandler, H.getDocumentHandler, H.saveDraftHandler, H.freezeHandler, H.getVersionHandler, H.diffHandler, H.exportHandler, H.downloadHandler];
    for (const h of all) {
      const res = await call(h, null, { id: uuid(), versionId: uuid(), exportId: uuid() }, { key: idem(), body: {} }, never);
      expect(res.status).toBe(401);
      expect(await json(res)).toEqual({ code: "AUTH_REQUIRED" });
    }
  });
});

describe("validasi permintaan", () => {
  it("create/freeze tanpa Idempotency-Key → 400; kategori tak dikenal → 400", async () => {
    const u = await createUser(pool);
    expect((await call(H.createDocumentHandler, u, {}, { body: { category: "NDA" } })).status).toBe(400);
    expect((await call(H.createDocumentHandler, u, {}, { key: idem(), body: { category: "LAIN" } })).status).toBe(400);
    const id = await newDoc(u);
    expect((await call(H.freezeHandler, u, { id }, { body: {} })).status).toBe(400);
  });

  it("body klien berisi owner_id/plan diabaikan", async () => {
    const victim = await createUser(pool);
    const u = await createUser(pool);
    const res = await call(H.createDocumentHandler, u, {}, { key: idem(), body: { category: "NDA", owner_id: victim, plan: "MEMBER" } });
    expect(res.status).toBe(201);
    expect(await service.list(victim)).toEqual([]);
    expect((await service.list(u))).toHaveLength(1);
  });

  it("pembekuan gagal validasi → 422 berisi errors per field dan draf utuh", async () => {
    const u = await createUser(pool);
    const id = await newDoc(u, { ...data, receivingParty: "  ", termMonths: 0 });
    const res = await call(H.freezeHandler, u, { id }, { key: idem(), body: {} });
    expect(res.status).toBe(422);
    const b = await json(res);
    expect(b.code).toBe("VALIDATION_FAILED");
    expect(Object.keys(b.errors).sort()).toEqual(["receivingParty", "termMonths"]);
    expect((await service.get(u, id))!.draft.data.disclosingParty).toBe("Sinta Dewi");
  });

  it("saveDraft: revisi basi → 409 STALE_REVISION; body salah → 400", async () => {
    const u = await createUser(pool);
    const { documentId } = await service.create(u, "NDA", idem());
    const ok = await call(H.saveDraftHandler, u, { id: documentId }, { body: { data: { disclosingParty: "A" }, revision: 0 } });
    expect(ok.status).toBe(200);
    const stale = await call(H.saveDraftHandler, u, { id: documentId }, { body: { data: { disclosingParty: "B" }, revision: 0 } });
    expect(stale.status).toBe(409);
    expect((await json(stale)).code).toBe("STALE_REVISION");
    expect((await call(H.saveDraftHandler, u, { id: documentId }, { body: { revision: "x" } })).status).toBe(400);
  });
});

describe("IDOR", () => {
  it("ID milik orang lain sama dengan ID acak: 404 dengan badan identik di semua handler", async () => {
    const a = await createUser(pool);
    const b = await createUser(pool);
    const f = await frozen(a);
    const exp = await json(await call(H.exportHandler, a, { versionId: f.versionId }, { body: { format: "PDF" } }));
    const targets: [typeof H.getDocumentHandler, Record<string, string>, Call?][] = [
      [H.getDocumentHandler, { id: f.id }],
      [H.saveDraftHandler, { id: f.id }, { body: { data: {}, revision: 0 } }],
      [H.freezeHandler, { id: f.id }, { key: idem(), body: {} }],
      [H.getVersionHandler, { versionId: f.versionId }],
      [H.diffHandler, { versionId: f.versionId }, { query: `?against=${f.versionId}` }],
      [H.exportHandler, { versionId: f.versionId }, { body: { format: "DOCX" } }],
      [H.downloadHandler, { exportId: exp.exportId }],
    ];
    for (const [h, p, o] of targets) {
      const mine = await call(h, b, p, o ?? {});
      expect(mine.status).toBe(404);
      const randomParams = Object.fromEntries(Object.keys(p).map((k) => [k, uuid()]));
      const random = await call(h, b, randomParams, o ?? {});
      expect(await json(mine)).toEqual(await json(random));
    }
  });

  it("diff dengan against milik orang lain → 404; id bukan uuid → 404", async () => {
    const a = await createUser(pool);
    const b = await createUser(pool);
    const fa = await frozen(a);
    const fb = await frozen(b);
    expect((await call(H.diffHandler, b, { versionId: fb.versionId }, { query: `?against=${fa.versionId}` })).status).toBe(404);
    expect((await call(H.getVersionHandler, b, { versionId: "bukan-uuid" })).status).toBe(404);
  });
});

describe("pembekuan, kuota, dan unduhan", () => {
  it("kuota habis → 429 dengan Retry-After > 0", async () => {
    const u = await createUser(pool);
    await frozen(u);
    const id = await newDoc(u);
    const res = await call(H.freezeHandler, u, { id }, { key: idem(), body: {} });
    expect(res.status).toBe(429);
    expect((await json(res)).code).toBe("DOCUMENT_DAILY_QUOTA_REACHED");
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("kunci sama dua kali → satu versi dan satu unit kuota", async () => {
    const u = await createUser(pool);
    const id = await newDoc(u);
    const k = idem();
    const a = await call(H.freezeHandler, u, { id }, { key: k, body: {} });
    const b = await call(H.freezeHandler, u, { id }, { key: k, body: {} });
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect((await json(b)).duplicate).toBe(true);
    expect((await service.get(u, id))!.versions).toHaveLength(1);
    expect((await store.snapshot(u, NOW)).documentsUsed).toBe(1);
  });

  it("ekspor lalu unduh: header benar dan tanpa cache", async () => {
    const u = await createUser(pool);
    const f = await frozen(u);
    const e = await json(await call(H.exportHandler, u, { versionId: f.versionId }, { body: { format: "PDF" } }));
    const res = await call(H.downloadHandler, u, { exportId: e.exportId });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="[a-z0-9-]+-v1\.pdf"$/);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(new TextDecoder().decode((await res.arrayBuffer()).slice(0, 5))).toBe("%PDF-");
  });

  it("diff dua versi mengembalikan perubahan blok", async () => {
    const u = await createUser(pool);
    const f = await frozen(u);
    await service.saveDraft(u, f.id, { ...data, termMonths: 36 }, 1);
    const second = await json(await call(H.freezeHandler, u, { id: f.id }, { key: idem(), body: {} }));
    const res = await call(H.diffHandler, u, { versionId: second.versionId }, { query: `?against=${f.versionId}` });
    expect(res.status).toBe(200);
    const changes = (await json(res)).changes as { id: string; change: string }[];
    expect(changes.filter((c) => c.change === "changed").map((c) => c.id)).toEqual(["term"]);
  });
});

// Smoke rilis (tanpa browser, tanpa jaringan). Dijalankan sekali sebelum pilot/rilis lewat `npm run test:smoke`, bukan bagian `npm run check`.
// Wajib: E01, E02, E03, E08, E13, E14. Ditambahkan karena wajib sebelum flag Deep/Enhanced dinyalakan: E04, E05, E09, E10, E11.
import { afterAll, describe, expect, it, vi } from "vitest";
import { handleChatTurn } from "@/lib/ai/chat-turn";
import { GatewayError } from "@/lib/ai/gateway";
import { createChatCache, handleChat } from "@/lib/ai/handle-chat";
import { handleAiReview } from "@/lib/ai/prereview";
import { createPgUsageStore } from "@/lib/ai/quota";
import { guardPath } from "@/lib/auth/permissions";
import { createManualAdapter, createMockAdapter } from "@/lib/billing/adapters";
import { createOrderHandler, type BillingDeps } from "@/lib/billing/handlers";
import { createPgBillingService } from "@/lib/billing/service";
import { decideHandler, eligibilityHandler, type DeepDeps } from "@/lib/deep/handlers";
import { createPgDeepService } from "@/lib/deep/service";
import { ForbiddenError } from "@/lib/documents/handlers";
import { openReviewHandler, publishHandler, type ReviewDeps } from "@/lib/reviews/handlers";
import { createPgReviewService } from "@/lib/reviews/service";
import { createPgVerificationService } from "@/lib/verification/service";
import { createUser, getPool } from "../db/helpers";
import { at, makeKit, NOW } from "../db/phase3-helpers";

const pool = getPool();
afterAll(() => pool.end());
const kit = makeKit(pool);
const store = createPgUsageStore(pool);
const verification = createPgVerificationService(pool);
const reviewSvc = createPgReviewService(pool);
const deepSvc = createPgDeepService(pool);
const billingSvc = createPgBillingService(pool, [createMockAdapter(), createManualAdapter("x")]);
const ID = "00000000-0000-4000-8000-000000000000";
const post = (body?: unknown, key: string | null = `k-${Math.random().toString(36).slice(2)}-abcdef`) =>
  new Request("http://t/x", { method: "POST", headers: { "content-type": "application/json", ...(key ? { "idempotency-key": key } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
const reviewDeps = (userId: string, roles: ("user" | "reviewer" | "partner_admin" | "platform_admin")[]): ReviewDeps => ({ getActor: async () => ({ userId, roles }), service: reviewSvc, now: () => NOW });
const deepDeps = (userId: string, roles: ("user" | "reviewer" | "partner_admin" | "platform_admin")[], flags = { deepReviewPurchase: true, enhancedIssuance: true }): DeepDeps => ({ getActor: async () => ({ userId, roles }), service: deepSvc, flags, now: () => NOW });
const billingDeps = (userId: string | null): BillingDeps => ({ getUserId: async () => userId, getAdminId: async () => { throw new ForbiddenError(); }, service: billingSvc, production: false, deepEnabled: true, now: () => NOW });
const lookup = (code: string) => verification.lookup(code);
const count = async (sql: string, args: unknown[]) => Number((await pool.query(sql, args)).rows[0].count);
const approveRubric = async () => pool.query("select admin_approve_rubric($1, 'v8-proposed', 'Persetujuan mitra #1', $2)", [await kit.admin(), NOW]);

// Menyelesaikan deep sampai siap diputuskan; opsi mengubah satu syarat.
async function readyDeep(o: { fail?: string; skipAttestCheck?: boolean } = {}) {
  await approveRubric();
  const c = await kit.completedStandard();
  const b = await kit.buy(c.owner, "DEEP_REVIEW", c.req);
  const deep = (await pool.query("select id from deep_requests where order_id = $1", [b.order_id])).rows[0].id as string;
  await pool.query("select assign_deep($1, $2, $3, $4)", [c.f.coordinator, deep, c.r.reviewer, NOW]);
  let rev = (await pool.query("select * from start_deep($1, $2, $3)", [c.r.reviewer, deep, NOW])).rows[0].revision as number;
  const bump = async (sql: string, args: unknown[]) => { rev = (await pool.query(sql, [c.r.reviewer, deep, rev, ...args, NOW])).rows[0].r as number; };
  await bump("select save_deep_draft($1, $2, $3, $4, $5, $6) as r", ["Pemeriksaan tambahan", "Ringkasan"]);
  await bump("select set_disposition($1, $2, $3, 1, 'RESOLVED', $4, $5) as r", ["Diperbaiki"]);
  for (const item of ["M1", "M2", "M3", "M4", "M5", "M6", "M7"]) await bump("select set_checklist($1, $2, $3, $4, $5, $6, $7, $8) as r", [item, item === o.fail ? "FAIL" : "PASS", "alasan", "bukti"]);
  return { c, deep, rev };
}

describe("E01 login sebelum AI", () => {
  it("anonim ditolak di semua pintu AI dan gateway tidak dipanggil; rute AI terlindungi di proxy", async () => {
    const chat = vi.fn(async () => ({ text: "x", requestId: "r" }));
    const c1 = await handleChat({ getUserId: async () => null, store, chat: chat as never, recordMetric: async () => {}, cache: createChatCache(), inflight: new Set() }, post({ messages: [{ role: "user", content: "halo" }] }));
    const c2 = await handleChatTurn({ getUserId: async () => null, service: kit.docs, store, pool, chat: chat as never, inflight: new Set() }, post({ message: "x".repeat(30) }), { id: ID });
    const c3 = await handleAiReview({ getUserId: async () => null, service: kit.docs, store, chat: chat as never, pool, verification, inflight: new Set(), enabled: () => true }, post({ consent: true }), { versionId: ID });
    expect([c1.status, c2.status, c3.status]).toEqual([401, 401, 401]);
    expect(chat).not.toHaveBeenCalled();
    expect(guardPath("/api/ai/chat", null)).toMatchObject({ allow: false });
    expect((await createOrderHandler(billingDeps(null), post({ kind: "MEMBERSHIP_MONTHLY" }))).status).toBe(401);
  });
});

describe("E02 peran dan akses berkas", () => {
  it("pengguna/reviewer ke permukaan admin ditolak; reviewer tak ditugaskan atau lintas firma tidak melihat berkas dan 404 tidak membocorkan metadata", async () => {
    expect(guardPath("/admin", ["user"])).toEqual({ allow: false, redirect: "/dashboard" });
    expect(guardPath("/admin", ["reviewer"])).toEqual({ allow: false, redirect: "/partner" });
    expect(guardPath("/api/admin/payments/x/confirm", ["reviewer"])).toMatchObject({ allow: false });
    const c = await kit.completedStandard();
    const outsiderFirm = await kit.firm();
    const cross = (await outsiderFirm.addReviewer()).reviewer;
    await expect(pool.query("select * from start_review($1, $2, $3)", [cross, c.req, NOW])).rejects.toThrow(/FORBIDDEN/);
    const a = await openReviewHandler(reviewDeps(cross, ["reviewer"]), post(), { id: c.req });
    const b = await openReviewHandler(reviewDeps(cross, ["reviewer"]), post(), { id: ID });
    expect([a.status, await a.text()]).toEqual([b.status, await b.text()]);
  });
});

describe("E03 review standar tanpa catatan", () => {
  it("Free Rp50.000, reviewer ditugaskan menerbitkan WITHIN_SCOPE untuk hash beku; tanpa Enhanced; tanpa tawaran deep", async () => {
    await pool.query("update firms set is_default = false");
    const f = await kit.firm({ isDefault: true });
    const r = await f.addReviewer();
    const owner = await createUser(pool);
    const v = await kit.frozen(owner);
    const o = await kit.order(owner, "STANDARD_REVIEW", v.versionId);
    expect(o.amount_idr).toBe(50000);
    const p = await kit.pay(owner, o.order_id);
    expect(await kit.settle("mock", p.ref, 50000)).toBe("SETTLED");
    const req = (await pool.query("select id from review_requests where order_id = $1", [o.order_id])).rows[0].id;
    await pool.query("select assign_review($1, $2, $3, $4)", [f.coordinator, req, r.reviewer, NOW]);
    const rv = reviewDeps(r.reviewer, ["reviewer"]);
    const opened = await (await openReviewHandler(rv, post(), { id: req })).json();
    await pool.query("select save_report_draft($1, $2, $3, 'Klausul kerahasiaan', '', '', $4)", [r.reviewer, req, opened.revision, NOW]);
    const pub = await publishHandler(rv, post({ revision: opened.revision + 1, outcome: "WITHIN_SCOPE", noNotesDeclared: true, attest: true }), { id: req });
    expect(pub.status).toBe(200);
    const code = (await pub.json()).code as string;
    const hash = (await pool.query("select sha256 from document_versions where id = $1", [v.versionId])).rows[0].sha256;
    expect(await lookup(code)).toMatchObject({ status: "ACTIVE", kind: "LEGAL", sha256: hash, outcome: "WITHIN_SCOPE" });
    expect(await count("select count(*) from document_verifications where request_id = $1 and kind = 'LEGAL_ENHANCED'", [req])).toBe(0);
    const e = await (await eligibilityHandler(deepDeps(owner, ["user"]), new Request(`http://t/x?parent=${req}`))).json();
    expect(e).toMatchObject({ eligible: false, reason: "NO_ACTIONABLE_NOTES", quote: null });
  });
});

describe("E04 review standar dengan catatan material", () => {
  it("WITH_NOTES memperlihatkan tingkat dan tindakan kepada pemilik dan menawarkan deep", async () => {
    const c = await kit.completedStandard({ severity: "MATERIAL" });
    const view = await reviewSvc.getForOwner(c.owner, c.req);
    expect(view?.outcome).toBe("WITH_NOTES");
    expect(view?.notes[0]).toMatchObject({ severity: "MATERIAL", recommendedAction: "Perjelas" });
    const e = await (await eligibilityHandler(deepDeps(c.owner, ["user"]), new Request(`http://t/x?parent=${c.req}`))).json();
    expect(e).toMatchObject({ eligible: true, quote: { amountIdr: 200000 } });
  });
});

describe("E05 deep tanpa syarat", () => {
  it("standar belum selesai, tanpa catatan aktionabel, atau induk dicabut: tidak ada order atau tugas, alasan dapat dibaca", async () => {
    const noNotes = await kit.completedStandard({ severity: "MINOR", actionable: false });
    const revoked = await kit.completedStandard();
    await pool.query("select revoke_verification($1, $2, 'ERROR', null, $3)", [revoked.f.admin, revoked.verificationId, NOW]);
    for (const [c, reason] of [[noNotes, "NO_ACTIONABLE_NOTES"], [revoked, "PARENT_NOT_ACTIVE"]] as const) {
      const e = await (await eligibilityHandler(deepDeps(c.owner, ["user"]), new Request(`http://t/x?parent=${c.req}`))).json();
      expect(e).toMatchObject({ eligible: false, reason });
      const r = await createOrderHandler(billingDeps(c.owner), post({ kind: "DEEP_REVIEW", parentRequestId: c.req }));
      expect([r.status, (await r.json()).reason]).toEqual([409, reason]);
      expect(await count("select count(*) from orders where kind = 'DEEP_REVIEW' and ref_id = $1", [c.req])).toBe(0);
      expect(await count("select count(*) from deep_requests where parent_request_id = $1", [c.req])).toBe(0);
    }
  });
});

describe("E08 pembayaran palsu dan callback ganda", () => {
  it("redirect/tangkapan layar tidak mengantrekan pekerjaan; callback ganda terverifikasi menghasilkan tepat satu pembayaran dan satu tugas", async () => {
    await pool.query("update firms set is_default = false");
    await kit.firm({ isDefault: true });
    const u = await createUser(pool);
    const v = await kit.frozen(u);
    const o = await kit.order(u, "STANDARD_REVIEW", v.versionId);
    const p = await kit.pay(u, o.order_id);
    expect(await count("select count(*) from review_requests where order_id = $1", [o.order_id])).toBe(0);
    expect(await kit.settle("mock", "ref-palsu", 50000)).toBe("NOT_FOUND");
    expect(await count("select count(*) from review_requests where order_id = $1", [o.order_id])).toBe(0);
    const rs = await Promise.all([1, 2, 3].map(() => kit.settle("mock", p.ref, 50000, NOW, "ev-sama")));
    expect(rs.filter((x) => x === "SETTLED")).toHaveLength(1);
    expect(await count("select count(*) from payments where order_id = $1 and status = 'VERIFIED'", [o.order_id])).toBe(1);
    expect(await count("select count(*) from review_requests where order_id = $1", [o.order_id])).toBe(1);
  });
});

describe("E09 Enhanced disetujui", () => {
  it("pekerjaan tambahan + M1–M7 lulus + bukti + APPROVE eksplisit menerbitkan tepat satu Enhanced; pembayaran saja tidak", async () => {
    const d = await readyDeep();
    expect(await count("select count(*) from document_verifications where kind = 'LEGAL_ENHANCED' and request_id = $1", [d.c.req])).toBe(0); // dibayar, belum diputuskan
    const r = await decideHandler(deepDeps(d.c.r.reviewer, ["reviewer"]), post({ revision: d.rev, decision: "APPROVE", attest: true }), { id: d.deep });
    expect(r.status).toBe(200);
    const done = await r.json();
    expect(await lookup(done.code)).toMatchObject({ status: "ACTIVE", kind: "LEGAL_ENHANCED" });
    expect(await count("select count(*) from document_verifications where kind = 'LEGAL_ENHANCED' and request_id = $1", [d.c.req])).toBe(1);
    expect(await lookup(d.c.code)).toMatchObject({ status: "ACTIVE", kind: "LEGAL" });
  });
});

describe("E10 deep dengan kriteria gagal atau tanpa atestasi", () => {
  it("FAIL, catatan material belum selesai, dan tanpa atestasi: nol Enhanced; DENY dengan alasan menyelesaikan pekerjaan", async () => {
    const failing = await readyDeep({ fail: "M3" });
    const rv = deepDeps(failing.c.r.reviewer, ["reviewer"]);
    const a = await decideHandler(rv, post({ revision: failing.rev, decision: "APPROVE", attest: true }), { id: failing.deep });
    expect([a.status, (await a.json()).reason]).toEqual([422, "MATERIAL_FAIL"]);
    const b = await decideHandler(rv, post({ revision: failing.rev, decision: "APPROVE", attest: false }), { id: failing.deep });
    expect([b.status, (await b.json()).code]).toEqual([422, "ATTESTATION_REQUIRED"]);
    const denied = await decideHandler(rv, post({ revision: failing.rev, decision: "DENY", reason: "Butir M3 tidak terpenuhi", attest: true }), { id: failing.deep });
    expect(denied.status).toBe(200);
    expect((await denied.json()).code).toBeNull();
    expect(await count("select count(*) from document_verifications where kind = 'LEGAL_ENHANCED' and request_id = $1", [failing.c.req])).toBe(0);
    expect((await pool.query("select outcome from deep_requests where id = $1", [failing.deep])).rows[0].outcome).toBe("COMPLETED_WITH_NOTES");
  });
});

describe("E11 otoritas dicabut, penugasan basi, dan admin", () => {
  it("otorisasi dicabut, reviewer lain, dan admin tidak dapat menerbitkan Enhanced", async () => {
    const d = await readyDeep();
    const body = { revision: d.rev, decision: "APPROVE", attest: true };
    expect((await decideHandler(deepDeps(d.c.f.admin, ["platform_admin"]), post(body), { id: d.deep })).status).toBe(403);
    const other = (await d.c.f.addReviewer()).reviewer;
    expect((await decideHandler(deepDeps(other, ["reviewer"]), post(body), { id: d.deep })).status).toBe(404);
    await pool.query("select admin_revoke_authorization($1, $2, $3)", [d.c.f.admin, d.c.r.authId, NOW]);
    const r = await decideHandler(deepDeps(d.c.r.reviewer, ["reviewer"]), post(body), { id: d.deep });
    expect([r.status, (await r.json()).code]).toEqual([403, "REVIEWER_NOT_AUTHORIZED"]);
    expect(await count("select count(*) from document_verifications where kind = 'LEGAL_ENHANCED' and request_id = $1", [d.c.req])).toBe(0);
  });
});

describe("E13 pencarian publik dan pencabutan", () => {
  it("kode tak dikenal; aktif; dicabut seketika; Enhanced turunan tidak aktif ketika induk dicabut", async () => {
    expect(await lookup("z".repeat(48))).toEqual({ status: "NOT_FOUND" });
    expect(await lookup("pendek")).toEqual({ status: "NOT_FOUND" });
    const d = await readyDeep();
    const approved = await (await decideHandler(deepDeps(d.c.r.reviewer, ["reviewer"]), post({ revision: d.rev, decision: "APPROVE", attest: true }), { id: d.deep })).json();
    const active = await lookup(d.c.code);
    expect(active).toMatchObject({ status: "ACTIVE", kind: "LEGAL" });
    expect(JSON.stringify(active)).not.toMatch(/Sinta|Budi|ZZ-RAHASIA|reviewer/);
    await verification.revoke(d.c.f.admin, d.c.verificationId, "ERROR", "alasan privat", NOW);
    expect(await lookup(d.c.code)).toMatchObject({ status: "REVOKED" });
    expect(await lookup(approved.code)).toMatchObject({ status: "SUSPENDED" });
    expect(JSON.stringify(await lookup(d.c.code))).not.toContain("alasan privat");
  });
});

describe("E14 batas kuota", () => {
  const keyed = () => `q-${Math.random().toString(36).slice(2)}`;
  it("Free 20/1/2: ulasan ke-3 ditolak, setiap ulasan sukses memakai satu pesan, pesan habis menolak ulasan walau sisa ulasan ada", async () => {
    const u = await createUser(pool);
    expect((await store.reserve(u, "AI_REVIEW", keyed(), NOW)).ok).toBe(true);
    expect((await store.reserve(u, "AI_REVIEW", keyed(), NOW)).ok).toBe(true);
    expect(await store.reserve(u, "AI_REVIEW", keyed(), NOW)).toMatchObject({ ok: false, code: "AI_REVIEW_QUOTA_REACHED" });
    const s = await store.snapshot(u, NOW);
    expect([s.messagesUsed, s.aiReviewsUsed, s.messageLimit, s.aiReviewLimit, s.documentLimit]).toEqual([2, 2, 20, 2, 1]);
    for (let i = 0; i < 18; i++) expect((await store.reserve(u, "MESSAGE", keyed(), NOW)).ok).toBe(true);
    expect(await store.reserve(u, "MESSAGE", keyed(), NOW)).toMatchObject({ ok: false, code: "AI_MESSAGE_QUOTA_REACHED" });
    const v = await createUser(pool);
    for (let i = 0; i < 20; i++) await store.reserve(v, "MESSAGE", keyed(), NOW);
    expect(await store.reserve(v, "AI_REVIEW", keyed(), NOW)).toMatchObject({ ok: false, code: "AI_MESSAGE_QUOTA_REACHED" });
  });

  it("Free 1 dokumen/hari; Member 60/5/10", async () => {
    const f = await createUser(pool);
    await kit.frozen(f);
    const second = await kit.docs.create(f, "NDA", keyed());
    const d2 = await kit.docs.get(f, second.documentId);
    await kit.docs.saveDraft(f, second.documentId, { disclosingParty: "A", receivingParty: "B", signingDate: "2026-10-16", confidentialInfo: "i", purpose: "t", termMonths: 12, disputeCity: "Jakarta" }, d2!.draft.revision);
    const r2 = await kit.docs.freeze(f, second.documentId, keyed(), NOW);
    expect(r2).toMatchObject({ ok: false, code: "DOCUMENT_DAILY_QUOTA_REACHED" });

    const m = await kit.member("2026-10-01", "2026-12-01");
    const s0 = await store.snapshot(m, NOW);
    expect([s0.messageLimit, s0.documentLimit, s0.aiReviewLimit]).toEqual([60, 5, 10]);
    for (let i = 0; i < 10; i++) expect((await store.reserve(m, "AI_REVIEW", keyed(), NOW)).ok).toBe(true);
    expect(await store.reserve(m, "AI_REVIEW", keyed(), NOW)).toMatchObject({ ok: false, code: "AI_REVIEW_QUOTA_REACHED" });
    for (let i = 0; i < 50; i++) expect((await store.reserve(m, "MESSAGE", keyed(), NOW)).ok).toBe(true);
    expect(await store.reserve(m, "MESSAGE", keyed(), NOW)).toMatchObject({ ok: false, code: "AI_MESSAGE_QUOTA_REACHED" });
    for (let i = 0; i < 5; i++) await kit.frozen(m);
    void at; void GatewayError;
  });
});

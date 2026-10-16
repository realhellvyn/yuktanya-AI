import { afterAll, describe, expect, it } from "vitest";
import type { Role } from "@/lib/auth/permissions";
import { createManualAdapter, createMockAdapter } from "@/lib/billing/adapters";
import { createOrderHandler, type BillingDeps } from "@/lib/billing/handlers";
import { createPgBillingService } from "@/lib/billing/service";
import { assignDeepHandler, decideHandler, deepQueueHandler, eligibilityHandler, getOwnerDeepHandler, openDeepHandler, saveDeepDraftHandler, setChecklistHandler, setDispositionHandler, type DeepDeps } from "@/lib/deep/handlers";
import { createPgDeepService } from "@/lib/deep/service";
import { ForbiddenError } from "@/lib/documents/handlers";
import { createUser, getPool } from "./helpers";
import { makeKit, NOW } from "./phase3-helpers";

const pool = getPool();
afterAll(() => pool.end());
const kit = makeKit(pool);
const service = createPgDeepService(pool);
const billing = createPgBillingService(pool, [createMockAdapter(), createManualAdapter("x")]);
const deps = (userId: string | null, roles: Role[], flags = { deepReviewPurchase: true, enhancedIssuance: true }): DeepDeps => ({
  getActor: async () => (userId ? { userId, roles } : null), service, flags, now: () => NOW,
});
const bdeps = (userId: string, deepEnabled: boolean): BillingDeps => ({
  getUserId: async () => userId, getAdminId: async () => { throw new ForbiddenError(); }, service: billing, production: false, deepEnabled, now: () => NOW,
});
const req = (body?: unknown, url = "http://t/x", key: string | null = `idem-${Math.random().toString(36).slice(2)}-abcd`) =>
  new Request(url, { method: "POST", headers: { "content-type": "application/json", ...(key ? { "idempotency-key": key } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
const ID = "00000000-0000-4000-8000-000000000000";

async function approve() {
  const admin = await kit.admin();
  await pool.query("select admin_approve_rubric($1, 'v8-proposed', 'Persetujuan mitra #1', $2)", [admin, NOW]);
}
async function paid() {
  const c = await kit.completedStandard();
  const b = await kit.buy(c.owner, "DEEP_REVIEW", c.req);
  const deep = (await pool.query("select id from deep_requests where order_id = $1", [b.order_id])).rows[0].id as string;
  return { c, deep };
}

describe("flag dan pembelian", () => {
  it("flag pembelian OFF: eligibility 404 dan /api/orders DEEP_REVIEW 404 FEATURE_DISABLED", async () => {
    const c = await kit.completedStandard();
    const off = deps(c.owner, ["user"], { deepReviewPurchase: false, enhancedIssuance: false });
    expect((await eligibilityHandler(off, req(undefined, `http://t/x?parent=${c.req}`))).status).toBe(404);
    const r = await createOrderHandler(bdeps(c.owner, false), req({ kind: "DEEP_REVIEW", parentRequestId: c.req }));
    expect([r.status, (await r.json()).code]).toEqual([404, "FEATURE_DISABLED"]);
  });

  it("flag ON: eligibility memberi harga server; order memakai harga server dan mengabaikan harga klien; tidak layak → 409 NOT_ELIGIBLE", async () => {
    const c = await kit.completedStandard();
    const e = await (await eligibilityHandler(deps(c.owner, ["user"]), req(undefined, `http://t/x?parent=${c.req}`))).json();
    expect(e).toEqual({ eligible: true, reason: "OK", quote: { amountIdr: 200000, variant: "FREE" }, standardPaidIdr: 50000 });
    const o = await createOrderHandler(bdeps(c.owner, true), req({ kind: "DEEP_REVIEW", parentRequestId: c.req, amount: 1 }));
    expect([o.status, (await o.json()).amountIdr]).toEqual([201, 200000]);
    const again = await createOrderHandler(bdeps(c.owner, true), req({ kind: "DEEP_REVIEW", parentRequestId: c.req }));
    expect([again.status, await again.json()]).toEqual([409, { code: "NOT_ELIGIBLE", reason: "DEEP_EXISTS" }]);
    const none = await createOrderHandler(bdeps(c.owner, true), req({ kind: "DEEP_REVIEW" }));
    expect(none.status).toBe(400);
  });

  it("pemilik lain dan induk acak mendapat 404 identik; anonim 401; peran profesional 403", async () => {
    const c = await kit.completedStandard();
    const other = deps(await createUser(pool), ["user"]);
    const a = await eligibilityHandler(other, req(undefined, `http://t/x?parent=${c.req}`));
    const b = await eligibilityHandler(other, req(undefined, `http://t/x?parent=${ID}`));
    expect([a.status, await a.text()]).toEqual([b.status, await b.text()]);
    expect((await eligibilityHandler(deps(null, []), req(undefined, `http://t/x?parent=${c.req}`))).status).toBe(401);
    expect((await eligibilityHandler(deps(c.r.reviewer, ["reviewer"]), req(undefined, `http://t/x?parent=${c.req}`))).status).toBe(403);
  });
});

describe("alur reviewer dan keputusan", () => {
  it("koordinator menugaskan, reviewer mengerjakan lewat API, APPROVE menerbitkan Enhanced bila flag ON; pemilik melihat hasil", async () => {
    await approve();
    const { c, deep } = await paid();
    expect((await assignDeepHandler(deps(c.f.coordinator, ["partner_admin"]), req({ reviewerId: c.r.reviewer }), { id: deep })).status).toBe(200);
    const rv = deps(c.r.reviewer, ["reviewer"]);
    expect((await (await deepQueueHandler(rv, req())).json()).queue).toHaveLength(1);
    const o = await (await openDeepHandler(rv, req(), { id: deep })).json();
    expect(o.parentNotes).toHaveLength(1);
    let rev = (await (await saveDeepDraftHandler(rv, req({ revision: o.revision, extraWork: "Pemeriksaan identitas", summary: "ok" }), { id: deep })).json()).revision;
    rev = (await (await setDispositionHandler(rv, req({ revision: rev, noteNo: 1, disposition: "RESOLVED", evidence: "Diperbaiki" }), { id: deep })).json()).revision;
    for (const item of ["M1", "M2", "M3", "M4", "M5", "M6", "M7"]) {
      rev = (await (await setChecklistHandler(rv, req({ revision: rev, item, result: "PASS", reasoning: "ok", evidenceRef: "bukti" }), { id: deep })).json()).revision;
    }
    const noAttest = await decideHandler(rv, req({ revision: rev, decision: "APPROVE", attest: false, noConflict: true }), { id: deep });
    expect([noAttest.status, (await noAttest.json()).code]).toEqual([422, "ATTESTATION_REQUIRED"]);
    const noConflict = await decideHandler(rv, req({ revision: rev, decision: "APPROVE", attest: true }), { id: deep });
    expect([noConflict.status, (await noConflict.json()).code]).toEqual([422, "CONFLICT_ATTESTATION_REQUIRED"]);
    const r = await decideHandler(rv, req({ revision: rev, decision: "APPROVE", attest: true, noConflict: true }), { id: deep });
    expect(r.status).toBe(200);
    const done = await r.json();
    expect(done.outcome).toBe("ENHANCED_APPROVED");
    const own = await (await getOwnerDeepHandler(deps(c.owner, ["user"]), req(), { id: deep })).json();
    expect([own.outcome, own.verification.code]).toEqual(["ENHANCED_APPROVED", done.code]);
  });

  it("flag Enhanced OFF: APPROVE → 409 ENHANCED_DISABLED tanpa menyentuh DB; keputusan lain tetap bekerja", async () => {
    await approve();
    const { c, deep } = await paid();
    await assignDeepHandler(deps(c.f.coordinator, ["partner_admin"]), req({ reviewerId: c.r.reviewer }), { id: deep });
    const rv = deps(c.r.reviewer, ["reviewer"], { deepReviewPurchase: true, enhancedIssuance: false });
    const o = await (await openDeepHandler(rv, req(), { id: deep })).json();
    const approveTry = await decideHandler(rv, req({ revision: o.revision, decision: "APPROVE", attest: true, noConflict: true }), { id: deep });
    expect([approveTry.status, (await approveTry.json()).code]).toEqual([409, "ENHANCED_DISABLED"]);
    expect((await pool.query("select status from deep_requests where id = $1", [deep])).rows[0].status).toBe("IN_REVIEW");
    const refer = await decideHandler(rv, req({ revision: o.revision, decision: "REFER_SPECIAL", reason: "Perlu penilaian khusus", attest: true, noConflict: true }), { id: deep });
    expect(refer.status).toBe(200);
    expect((await refer.json()).verificationId).toBeNull();
  });

  it("admin, koordinator, dan pemilik tidak dapat membuka atau memutuskan (403); reviewer bukan penugasan 404; N_A wajib M4 → 422", async () => {
    const { c, deep } = await paid();
    await assignDeepHandler(deps(c.f.coordinator, ["partner_admin"]), req({ reviewerId: c.r.reviewer }), { id: deep });
    for (const d of [deps(c.f.admin, ["platform_admin"]), deps(c.f.coordinator, ["partner_admin"]), deps(c.owner, ["user"])]) {
      expect((await openDeepHandler(d, req(), { id: deep })).status).toBe(403);
      expect((await decideHandler(d, req({ revision: 0, decision: "DENY", reason: "alasan lengkap", attest: true, noConflict: true }), { id: deep })).status).toBe(403);
    }
    const stranger = deps((await c.f.addReviewer()).reviewer, ["reviewer"]);
    const a = await openDeepHandler(stranger, req(), { id: deep });
    const b = await openDeepHandler(stranger, req(), { id: ID });
    expect([a.status, await a.text()]).toEqual([b.status, await b.text()]);
    const rv = deps(c.r.reviewer, ["reviewer"]);
    const o = await (await openDeepHandler(rv, req(), { id: deep })).json();
    const na = await setChecklistHandler(rv, req({ revision: o.revision, item: "M4", result: "N_A", reasoning: "x", evidenceRef: "" }), { id: deep });
    expect([na.status, (await na.json()).reason]).toEqual([422, "MANDATORY_ITEM"]);
  });

  it("guard negatif tampil sebagai 422 dengan alasan (UNAPPROVED_RUBRIC)", async () => {
    await pool.query("delete from rubric_approvals");
    const { c, deep } = await paid();
    await assignDeepHandler(deps(c.f.coordinator, ["partner_admin"]), req({ reviewerId: c.r.reviewer }), { id: deep });
    const rv = deps(c.r.reviewer, ["reviewer"]);
    const o = await (await openDeepHandler(rv, req(), { id: deep })).json();
    const rev = (await (await saveDeepDraftHandler(rv, req({ revision: o.revision, extraWork: "kerja", summary: "" }), { id: deep })).json()).revision;
    const r = await decideHandler(rv, req({ revision: rev, decision: "APPROVE", attest: true, noConflict: true }), { id: deep });
    expect(r.status).toBe(422);
    const body = await r.json();
    expect(body.code).toBe("VALIDATION_FAILED");
    expect(body.reason).toBe("UNAPPROVED_RUBRIC");
  });
});

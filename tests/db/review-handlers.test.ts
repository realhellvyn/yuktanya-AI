import { afterAll, describe, expect, it } from "vitest";
import type { Role } from "@/lib/auth/permissions";
import { reassignHandler, assignHandler, deleteNoteHandler, getOwnerReviewHandler, listOwnerReviewsHandler, openReviewHandler, publishHandler, reviewerQueueHandler, saveDraftHandler, unassignedHandler, upsertNoteHandler, type ReviewDeps } from "@/lib/reviews/handlers";
import { createPgReviewService } from "@/lib/reviews/service";
import { createUser, getPool } from "./helpers";
import { makeKit, NOW } from "./phase3-helpers";

const pool = getPool();
afterAll(() => pool.end());
const kit = makeKit(pool);
const service = createPgReviewService(pool);
const as = (userId: string | null, roles: Role[]): ReviewDeps => ({ getActor: async () => (userId ? { userId, roles } : null), service, now: () => NOW });
const req = (body?: unknown, url = "http://t/x") => new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const ID = "00000000-0000-4000-8000-000000000000";

async function setup() {
  await pool.query("update firms set is_default = false");
  const f = await kit.firm({ isDefault: true });
  const r = await f.addReviewer();
  const owner = await createUser(pool);
  const v = await kit.frozen(owner);
  const b = await kit.buy(owner, "STANDARD_REVIEW", v.versionId);
  const rid = (await pool.query("select id from review_requests where order_id = $1", [b.order_id])).rows[0].id as string;
  return { f, reviewer: r.reviewer, owner, rid, v };
}

describe("handler review", () => {
  it("anonim 401 di semua handler", async () => {
    const d = as(null, []);
    for (const res of [await listOwnerReviewsHandler(d, req()), await reviewerQueueHandler(d, req()), await openReviewHandler(d, req(), { id: ID }), await unassignedHandler(d, req())]) expect(res.status).toBe(401);
  });

  it("alur lengkap: koordinator menugaskan, reviewer menulis dan menerbitkan, pemilik melihat catatan terpublikasi", async () => {
    const c = await setup();
    const coord = as(c.f.coordinator, ["partner_admin"]);
    const un = await (await unassignedHandler(coord, req())).json();
    expect(un.requests.map((x: { requestId: string }) => x.requestId)).toContain(c.rid);
    expect((await assignHandler(coord, req({ reviewerId: c.reviewer }), { id: c.rid })).status).toBe(200);

    const rv = as(c.reviewer, ["reviewer"]);
    expect((await (await reviewerQueueHandler(rv, req())).json()).queue.map((q: { requestId: string }) => q.requestId)).toEqual([c.rid]);
    const opened = await (await openReviewHandler(rv, req(), { id: c.rid })).json();
    expect(opened.doc.blocks.length).toBeGreaterThan(0);
    let rev = (await (await saveDraftHandler(rv, req({ revision: opened.revision, scope: "Klausul kerahasiaan", assumptions: "Data benar", summary: "" }), { id: c.rid })).json()).revision;
    const note = await (await upsertNoteHandler(rv, req({ revision: rev, title: "Jangka waktu", finding: "Tidak jelas", severity: "MINOR", actionable: true, recommendedAction: "Perjelas" }), { id: c.rid })).json();
    rev = note.revision;

    const draftView = await (await getOwnerReviewHandler(as(c.owner, ["user"]), req(), { id: c.rid })).json();
    expect(draftView.notes).toEqual([]);

    const pub = await publishHandler(rv, req({ revision: rev, outcome: "WITH_NOTES", noNotesDeclared: false, attest: true, noConflict: true }), { id: c.rid });
    expect(pub.status).toBe(200);
    const done = await pub.json();
    expect(done.code.length).toBeGreaterThanOrEqual(40);

    const owner = await (await getOwnerReviewHandler(as(c.owner, ["user"]), req(), { id: c.rid })).json();
    expect(owner.notes).toHaveLength(1);
    expect(owner.verification.code).toBe(done.code);
    expect(owner.outcome).toBe("WITH_NOTES");
  });

  it("publish tanpa atestasi → 422; hapus catatan dengan revisi basi → 409", async () => {
    const c = await setup();
    await assignHandler(as(c.f.coordinator, ["partner_admin"]), req({ reviewerId: c.reviewer }), { id: c.rid });
    const rv = as(c.reviewer, ["reviewer"]);
    const o = await (await openReviewHandler(rv, req(), { id: c.rid })).json();
    const rev = (await (await saveDraftHandler(rv, req({ revision: o.revision, scope: "Lingkup", assumptions: "", summary: "" }), { id: c.rid })).json()).revision;
    const r = await publishHandler(rv, req({ revision: rev, outcome: "WITHIN_SCOPE", noNotesDeclared: true, attest: false, noConflict: true }), { id: c.rid });
    expect([r.status, (await r.json()).code]).toEqual([422, "ATTESTATION_REQUIRED"]);
    const noConflict = await publishHandler(rv, req({ revision: rev, outcome: "WITHIN_SCOPE", noNotesDeclared: true, attest: true }), { id: c.rid });
    expect([noConflict.status, (await noConflict.json()).code]).toEqual([422, "CONFLICT_ATTESTATION_REQUIRED"]);
    const stale = await deleteNoteHandler(rv, new Request(`http://t/x?revision=${rev - 1}`, { method: "DELETE" }), { id: c.rid, noteNo: "1" });
    expect(stale.status).toBe(409);
    const bad = await publishHandler(rv, req({ revision: rev, outcome: "WITH_NOTES", noNotesDeclared: false, attest: true, noConflict: true }), { id: c.rid });
    expect([bad.status, (await bad.json()).reason]).toEqual([422, "NOTES_REQUIRED"]);
  });

  it("reviewer yang bukan penugasan mendapat 404 pada open dan publish; peran sesi saja tidak cukup", async () => {
    const c = await setup();
    await assignHandler(as(c.f.coordinator, ["partner_admin"]), req({ reviewerId: c.reviewer }), { id: c.rid });
    const other = await c.f.addReviewer();
    const rv = as(other.reviewer, ["reviewer"]);
    const a = await openReviewHandler(rv, req(), { id: c.rid });
    const b = await openReviewHandler(rv, req(), { id: ID });
    expect([a.status, await a.text()]).toEqual([b.status, await b.text()]);
    expect((await publishHandler(rv, req({ revision: 0, outcome: "WITHIN_SCOPE", noNotesDeclared: true, attest: true, noConflict: true }), { id: c.rid })).status).toBe(404);
    expect((await reviewerQueueHandler(rv, req())).status).toBe(200);
    expect((await (await reviewerQueueHandler(rv, req())).json()).queue).toEqual([]);
  });

  it("koordinator, admin, dan pemilik tidak dapat membuka atau menerbitkan (403 peran sesi)", async () => {
    const c = await setup();
    await assignHandler(as(c.f.coordinator, ["partner_admin"]), req({ reviewerId: c.reviewer }), { id: c.rid });
    for (const d of [as(c.f.coordinator, ["partner_admin"]), as(c.f.admin, ["platform_admin"]), as(c.owner, ["user"])]) {
      expect((await openReviewHandler(d, req(), { id: c.rid })).status).toBe(403);
      expect((await publishHandler(d, req({ revision: 0, outcome: "WITHIN_SCOPE", attest: true, noConflict: true, noNotesDeclared: true }), { id: c.rid })).status).toBe(403);
    }
  });

  it("admin platform tidak memakai API mitra untuk perutean (403; perutean admin lewat /admin/routing)", async () => {
    const c = await setup();
    const adm = as(c.f.admin, ["user", "platform_admin"]);
    expect((await unassignedHandler(adm, req())).status).toBe(403);
    expect((await assignHandler(adm, req({ reviewerId: c.reviewer }), { id: c.rid })).status).toBe(403);
    expect((await reassignHandler(adm, req({ reviewerId: c.reviewer }), { id: c.rid })).status).toBe(403);
    expect((await pool.query("select status from review_requests where id = $1", [c.rid])).rows[0].status).toBe("QUEUED");
  });

  it("pemilik tidak dapat membaca review orang lain (404 identik) dan peran profesional tidak memakai rute pemilik", async () => {
    const c = await setup();
    const other = as(await createUser(pool), ["user"]);
    const a = await getOwnerReviewHandler(other, req(), { id: c.rid });
    const b = await getOwnerReviewHandler(other, req(), { id: ID });
    expect([a.status, await a.text()]).toEqual([b.status, await b.text()]);
    expect((await getOwnerReviewHandler(as(c.reviewer, ["reviewer"]), req(), { id: c.rid })).status).toBe(403);
  });

  it("penugasan: pengguna biasa 403; koordinator firma lain 404; reviewer tidak berwenang 403", async () => {
    const c = await setup();
    expect((await assignHandler(as(c.owner, ["user"]), req({ reviewerId: c.reviewer }), { id: c.rid })).status).toBe(403);
    const otherFirm = await kit.firm();
    expect((await assignHandler(as(otherFirm.coordinator, ["partner_admin"]), req({ reviewerId: c.reviewer }), { id: c.rid })).status).toBe(404);
    const outsider = await createUser(pool);
    const r = await assignHandler(as(c.f.coordinator, ["partner_admin"]), req({ reviewerId: outsider }), { id: c.rid });
    expect([r.status, (await r.json()).code]).toEqual([403, "REVIEWER_NOT_AUTHORIZED"]);
  });

  it("reassign: koordinator memindahkan pekerjaan tertahan; unassigned memuat inflight; pengguna biasa 403", async () => {
    const c = await setup();
    const other = await c.f.addReviewer();
    const coord = as(c.f.coordinator, ["partner_admin"]);
    await assignHandler(coord, req({ reviewerId: c.reviewer }), { id: c.rid });
    const view = await (await unassignedHandler(coord, req())).json();
    expect(view.inflight.map((x: { requestId: string }) => x.requestId)).toContain(c.rid);
    expect((await reassignHandler(as(c.owner, ["user"]), req({ reviewerId: other.reviewer }), { id: c.rid })).status).toBe(403);
    expect((await reassignHandler(coord, req({ reviewerId: other.reviewer }), { id: c.rid })).status).toBe(200);
    expect((await (await reviewerQueueHandler(as(other.reviewer, ["reviewer"]), req())).json()).queue).toHaveLength(1);
    expect((await (await reviewerQueueHandler(as(c.reviewer, ["reviewer"]), req())).json()).queue).toHaveLength(0);
  });
});

import { afterAll, describe, expect, it } from "vitest";
import { orderSubject } from "@/lib/billing/checkout-subject";
import { createPgDocumentsService } from "@/lib/documents/service";
import { versionStatuses } from "@/lib/documents/version-status";
import { createPgReviewService } from "@/lib/reviews/service";
import { createUser, getPool } from "./helpers";
import { at, key, makeKit, ndaData, NOW } from "./phase3-helpers";

// Task 14 (audit D): data yang dibutuhkan layar pemilik — subjek checkout (D-06), status pemeriksaan per versi (D-04),
// pemeriksa/tanggal/linimasa dan kredit DECLINED pada hasil pemeriksaan (D-07/D-14).
const pool = getPool();
afterAll(() => pool.end());
const kit = makeKit(pool);
const docs = createPgDocumentsService(pool, { ALLOW_UNAPPROVED_TEMPLATES: "true", NODE_ENV: "test" });
const reviews = createPgReviewService(pool);

async function secondVersion(owner: string, documentId: string) {
  const d = (await docs.get(owner, documentId))!;
  await docs.saveDraft(owner, documentId, { ...ndaData, purpose: "Tujuan yang diubah" }, d.draft.revision);
  const r = await docs.freeze(owner, documentId, key(), at(5));
  if (!r.ok) throw new Error(`freeze gagal: ${r.code}`);
  return r.versionId;
}

describe("orderSubject (checkout D-06)", () => {
  it("Standar: judul, nomor versi, dan kode versi milik pemilik; Deep: versi induk; bukan pemilik: null; membership: null", async () => {
    const c = await kit.completedStandard({ severity: "MATERIAL", member: true });
    const std = await kit.order(c.owner, "STANDARD_REVIEW", (await kit.frozen(c.owner)).versionId);
    const stdOrder = (await pool.query("select kind, ref_id from orders where id = $1", [std.order_id])).rows[0];
    const s = await orderSubject(pool, c.owner, { kind: stdOrder.kind, refId: stdOrder.ref_id });
    expect(s).toMatchObject({ title: expect.stringContaining("Kerahasiaan"), versionNo: 1 });
    expect(s!.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await orderSubject(pool, await createUser(pool), { kind: stdOrder.kind, refId: stdOrder.ref_id })).toBeNull();
    const deep = await orderSubject(pool, c.owner, { kind: "DEEP_REVIEW", refId: c.req });
    expect(deep).toMatchObject({ versionNo: 1, documentId: c.v.documentId });
    expect(await orderSubject(pool, c.owner, { kind: "MEMBERSHIP_MONTHLY", refId: null })).toBeNull();
  });
});

describe("versionStatuses (D-04)", () => {
  it("versi yang diperiksa memegang hasilnya; versi baru tetap belum diperiksa; pencabutan terlihat", async () => {
    const owner = await kit.member("2026-10-01", "2027-12-01");
    const c = await kit.completedStandard({ owner, severity: "MATERIAL" });
    const v2 = await secondVersion(owner, c.v.documentId);
    let st = await versionStatuses(pool, owner, c.v.documentId);
    expect(st[c.v.versionId]).toMatchObject({ review: "COMPLETED", outcome: "WITH_NOTES", legal: "ACTIVE" });
    expect(st[v2]).toMatchObject({ review: null, legal: null });
    await pool.query("select revoke_verification($1, $2, 'ERROR', 'uji', $3)", [c.f.admin, c.verificationId, NOW]);
    st = await versionStatuses(pool, owner, c.v.documentId);
    expect(st[c.v.versionId].legal).toBe("REVOKED");
    // Bukan pemilik: tidak ada data.
    expect(await versionStatuses(pool, await createUser(pool), c.v.documentId)).toEqual({});
  });
});

describe("getForOwner: pemeriksa, tanggal, linimasa, kredit (D-07/D-14)", () => {
  it("menyebut firma pemeriksa dan tanggal tiap tahap, tanpa identitas pribadi reviewer", async () => {
    const c = await kit.completedStandard({ severity: "MATERIAL" });
    const r = (await reviews.getForOwner(c.owner, c.req))!;
    const firm = (await pool.query("select f.name from firms f join review_requests r on r.firm_id = f.id where r.id = $1", [c.req])).rows[0].name;
    expect(r.firmName).toBe(firm);
    expect(r.documentId).toBe(c.v.documentId);
    expect(r.completedAt).toBe(NOW.toISOString());
    expect(r.timeline).toMatchObject({ orderedAt: expect.any(String), paidAt: expect.any(String), queuedAt: expect.any(String), assignedAt: NOW.toISOString(), completedAt: NOW.toISOString() });
    expect(JSON.stringify(r)).not.toContain(c.r.reviewer);
    expect(r.credit).toBeNull();
  });

  it("DECLINED: order dibatalkan dan diganti satu kredit pemeriksaan (sesuai publish_standard)", async () => {
    const f = await kit.firm({ isDefault: true });
    await pool.query("update firms set is_default = (id = $1)", [f.firmId]);
    const rv = await f.addReviewer();
    const owner = await createUser(pool);
    const v = await kit.frozen(owner);
    const b = await kit.buy(owner, "STANDARD_REVIEW", v.versionId);
    const req = (await pool.query("select id from review_requests where order_id = $1", [b.order_id])).rows[0].id as string;
    await pool.query("select assign_review($1, $2, $3, $4)", [f.coordinator, req, rv.reviewer, NOW]);
    const s = (await pool.query("select * from start_review($1, $2, $3)", [rv.reviewer, req, NOW])).rows[0];
    const rev = (await pool.query("select save_report_draft($1, $2, $3, 'Lingkup', 'Asumsi', 'Di luar keahlian', $4) as r", [rv.reviewer, req, s.revision, NOW])).rows[0].r as number;
    await pool.query("select * from publish_standard($1, $2, $3, 'DECLINED', false, true, true, $4)", [rv.reviewer, req, rev, NOW]);
    const r = (await reviews.getForOwner(owner, req))!;
    expect(r.status).toBe("DECLINED");
    expect(r.credit).toMatchObject({ status: "AVAILABLE" });
    expect(new Date(r.credit!.expiresAt).getTime()).toBeGreaterThan(NOW.getTime());
    expect((await pool.query("select status from orders where id = $1", [b.order_id])).rows[0].status).toBe("CANCELLED");
  });
});

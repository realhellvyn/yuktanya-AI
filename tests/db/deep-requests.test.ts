import { afterAll, describe, expect, it } from "vitest";
import { createUser, getPool } from "./helpers";
import { at, makeKit, NOW } from "./phase3-helpers";

const pool = getPool();
afterAll(() => pool.end());
const kit = makeKit(pool);
const assignDeep = (actor: string, deep: string, reviewer: string, now: Date = NOW) => pool.query("select assign_deep($1, $2, $3, $4)", [actor, deep, reviewer, now]);

async function paidDeep(opts: Parameters<typeof kit.completedStandard>[0] = {}) {
  const c = await kit.completedStandard(opts);
  const b = await kit.buy(c.owner, "DEEP_REVIEW", c.req);
  const deep = (await pool.query("select * from deep_requests where order_id = $1", [b.order_id])).rows[0];
  return { c, b, deep };
}

describe("settlement deep", () => {
  it("membuat tepat satu permintaan QUEUED terikat induk, versi, dan hash", async () => {
    const { c, b, deep } = await paidDeep();
    expect(b.settled).toBe("SETTLED");
    expect(deep.status).toBe("QUEUED");
    expect(deep.parent_request_id).toBe(c.req);
    const hash = (await pool.query("select version_sha256 from review_requests where id = $1", [c.req])).rows[0].version_sha256;
    expect(deep.version_sha256).toBe(hash);
    expect(deep.firm_id).toBe(c.f.firmId);
  });

  it("callback ganda dan serentak → satu pekerjaan", async () => {
    const c = await kit.completedStandard();
    const o = await kit.order(c.owner, "DEEP_REVIEW", c.req);
    const p = await kit.pay(c.owner, o.order_id);
    const rs = await Promise.all(Array.from({ length: 4 }, () => kit.settle("mock", p.ref, 200000, NOW, "same")));
    expect(rs.filter((r) => r === "SETTLED")).toHaveLength(1);
    expect((await pool.query("select count(*) from deep_requests where parent_request_id = $1", [c.req])).rows[0].count).toBe("1");
  });

  it("induk dicabut sebelum settlement → uang tercatat, RECONCILIATION_REQUIRED, tanpa pekerjaan", async () => {
    const c = await kit.completedStandard();
    const o = await kit.order(c.owner, "DEEP_REVIEW", c.req);
    const p = await kit.pay(c.owner, o.order_id);
    await pool.query("select revoke_verification($1, $2, 'ERROR', null, $3)", [c.f.admin, c.verificationId, NOW]);
    expect(await kit.settle("mock", p.ref, 200000)).toBe("RECONCILIATION_REQUIRED");
    expect((await pool.query("select status from orders where id = $1", [o.order_id])).rows[0].status).toBe("RECONCILIATION_REQUIRED");
    expect((await pool.query("select status from payments where id = $1", [p.paymentId])).rows[0].status).toBe("DISPUTED");
    expect((await pool.query("select count(*) from deep_requests where parent_request_id = $1", [c.req])).rows[0].count).toBe("0");
    await expect(pool.query("select admin_resolve_reconciliation($1, $2, 'ACTIVATE', 'cek manual ok', $3)", [c.f.admin, o.order_id, NOW])).rejects.toThrow(/NOT_ELIGIBLE/);
  });

  it("jumlah salah atau kedaluwarsa → tanpa pekerjaan", async () => {
    const c = await kit.completedStandard();
    const o = await kit.order(c.owner, "DEEP_REVIEW", c.req);
    const p = await kit.pay(c.owner, o.order_id);
    expect(await kit.settle("mock", p.ref, 150000)).toBe("AMOUNT_MISMATCH");
    const d = await kit.completedStandard();
    const o2 = await kit.order(d.owner, "DEEP_REVIEW", d.req);
    const p2 = await kit.pay(d.owner, o2.order_id);
    expect(await kit.settle("mock", p2.ref, 200000, at(25 * 60))).toBe("RECONCILIATION_REQUIRED");
    expect((await pool.query("select count(*) from deep_requests where parent_request_id = any($1)", [[c.req, d.req]])).rows[0].count).toBe("0");
  });

  it("order deep tidak memberi, memakai, atau melepas entitlement diskon pertama", async () => {
    const { b } = await paidDeep({ member: true });
    expect((await pool.query("select count(*) from review_discount_entitlements where order_id = $1", [b.order_id])).rows[0].count).toBe("0");
  });
});

describe("penugasan deep", () => {
  it("koordinator firmanya menugaskan; aktor lain FORBIDDEN; reviewer tak berwenang atau pemilik ditolak; kapasitas menghitung standar+deep", async () => {
    const { c, deep } = await paidDeep();
    const other = await kit.firm();
    const rv = await c.f.addReviewer();
    for (const actor of [other.coordinator, rv.reviewer, c.owner, await createUser(pool)]) await expect(assignDeep(actor, deep.id, rv.reviewer)).rejects.toThrow(/FORBIDDEN/);
    await expect(assignDeep(c.f.coordinator, deep.id, c.owner)).rejects.toThrow(/REVIEWER_NOT_AUTHORIZED/);
    await expect(assignDeep(c.f.coordinator, deep.id, await createUser(pool))).rejects.toThrow(/REVIEWER_NOT_AUTHORIZED/);
    await assignDeep(c.f.coordinator, deep.id, rv.reviewer);
    expect((await pool.query("select status from deep_requests where id = $1", [deep.id])).rows[0].status).toBe("QUEUED");
    expect((await pool.query("select * from deep_queue($1)", [rv.reviewer])).rows).toHaveLength(1);
  });

  it("koordinator firma lain tidak melihat permintaan standar maupun deep firma ini (antrean dan yang sedang berjalan)", async () => {
    const { c, deep } = await paidDeep();
    const other = await kit.firm();
    const rv = await c.f.addReviewer();
    const u = await createUser(pool);
    const b = await kit.buy(u, "STANDARD_REVIEW", (await kit.frozen(u)).versionId);
    const queued = (await pool.query("select id from review_requests where order_id = $1", [b.order_id])).rows[0].id;
    const u2 = await createUser(pool);
    const b2 = await kit.buy(u2, "STANDARD_REVIEW", (await kit.frozen(u2)).versionId);
    const running = (await pool.query("select id from review_requests where order_id = $1", [b2.order_id])).rows[0].id;
    await pool.query("select assign_review($1, $2, $3, $4)", [c.f.coordinator, running, rv.reviewer, NOW]);
    const ids = async (actor: string) => {
      const q = async (sql: string, args: unknown[]) => (await pool.query(sql, args)).rows.map((r) => r.request_id ?? r.deep_id);
      return [
        ...(await q("select * from coordinator_unassigned($1)", [actor])), ...(await q("select * from coordinator_inflight($1, $2)", [actor, NOW])),
        ...(await q("select * from deep_unassigned($1)", [actor])),
      ];
    };
    expect(await ids(c.f.coordinator)).toEqual(expect.arrayContaining([queued, running, deep.id]));
    const seen = await ids(other.coordinator);
    for (const id of [queued, running, deep.id]) expect(seen).not.toContain(id);
    await assignDeep(c.f.coordinator, deep.id, rv.reviewer);
    expect((await pool.query("select * from deep_inflight($1, $2)", [c.f.coordinator, NOW])).rows.map((r) => r.deep_id)).toContain(deep.id);
    expect((await pool.query("select * from deep_inflight($1, $2)", [other.coordinator, NOW])).rows.map((r) => r.deep_id)).not.toContain(deep.id);
  });

  it("kapasitas 10 menghitung penugasan standar dan deep bersama", async () => {
    const { c, deep } = await paidDeep();
    const rv = await c.f.addReviewer();
    await assignDeep(c.f.coordinator, deep.id, rv.reviewer);
    for (let i = 0; i < 9; i++) {
      const u = await createUser(pool);
      const v = await kit.frozen(u);
      const b = await kit.buy(u, "STANDARD_REVIEW", v.versionId);
      const req = (await pool.query("select id from review_requests where order_id = $1", [b.order_id])).rows[0].id;
      await pool.query("select assign_review($1, $2, $3, $4)", [c.f.coordinator, req, rv.reviewer, NOW]);
    }
    const u = await createUser(pool);
    const v = await kit.frozen(u);
    const b = await kit.buy(u, "STANDARD_REVIEW", v.versionId);
    const req = (await pool.query("select id from review_requests where order_id = $1", [b.order_id])).rows[0].id;
    await expect(pool.query("select assign_review($1, $2, $3, $4)", [c.f.coordinator, req, rv.reviewer, NOW])).rejects.toThrow(/REVIEWER_AT_CAPACITY/);
  });

  it("reassign memindahkan pekerjaan; deep_inflight menandai otoritas yang tidak aktif; pemilik hilang dari antrean lama", async () => {
    const { c, deep } = await paidDeep();
    const a = await c.f.addReviewer();
    const b = await c.f.addReviewer();
    await assignDeep(c.f.coordinator, deep.id, a.reviewer);
    await pool.query("select admin_revoke_authorization($1, $2, $3)", [c.f.admin, a.authId, NOW]);
    const row = (await pool.query("select * from deep_inflight($1, $2)", [c.f.coordinator, NOW])).rows.find((x) => x.deep_id === deep.id);
    expect([row.reviewer_id, row.reviewer_authorized]).toEqual([a.reviewer, false]);
    await pool.query("select reassign_deep($1, $2, $3, $4)", [c.f.coordinator, deep.id, b.reviewer, NOW]);
    expect((await pool.query("select * from deep_queue($1)", [a.reviewer])).rows).toHaveLength(0);
    expect((await pool.query("select * from deep_queue($1)", [b.reviewer])).rows).toHaveLength(1);
    expect((await pool.query("select * from deep_unassigned($1)", [c.f.coordinator])).rows.some((x) => x.deep_id === deep.id)).toBe(false);
  });
});

describe("ketergantungan pada verifikasi induk", () => {
  it("pencabutan induk menahan deep yang belum selesai dan menangguhkan Enhanced turunan; pencabutan Enhanced tidak mencabut induk", async () => {
    const { c, deep, b } = await paidDeep();
    const rv = await c.f.addReviewer();
    await assignDeep(c.f.coordinator, deep.id, rv.reviewer);
    await pool.query("select revoke_verification($1, $2, 'MISLEADING', 'alasan', $3)", [c.f.admin, c.verificationId, NOW]);
    expect((await pool.query("select status from deep_requests where id = $1", [deep.id])).rows[0].status).toBe("ON_HOLD");
    // Tidak buntu: penugasan berakhir (kapasitas bebas), pembayaran dan order masuk daftar rekonsiliasi, admin dapat mencatat pengembalian.
    expect((await pool.query("select status from deep_assignments where deep_id = $1", [deep.id])).rows.map((x) => x.status)).toEqual(["ENDED"]);
    expect((await pool.query("select status from orders where id = $1", [b.order_id])).rows[0].status).toBe("RECONCILIATION_REQUIRED");
    expect((await pool.query("select status from payments where order_id = $1", [b.order_id])).rows[0].status).toBe("DISPUTED");
    await expect(pool.query("select admin_resolve_reconciliation($1, $2, 'ACTIVATE', 'coba aktifkan', $3)", [c.f.admin, b.order_id, NOW])).rejects.toThrow(/NOT_ELIGIBLE/);
    expect((await pool.query("select admin_resolve_reconciliation($1, $2, 'REFUND_RECORDED', 'dikembalikan via bank', $3) as r", [c.f.admin, b.order_id, NOW])).rows[0].r).toBe("REFUND_RECORDED");
    // Enhanced turunan (dibuat langsung untuk menguji kaskade) menjadi SUSPENDED.
    const d = await paidDeep();
    const sha = (await pool.query("select sha256 from document_verifications where id = $1", [d.c.verificationId])).rows[0].sha256;
    const enh = (await pool.query(
      "insert into document_verifications (kind, version_id, sha256, outcome, policy_version, code, request_id, parent_verification_id, issued_at) values ('LEGAL_ENHANCED', $1, $2, 'ENHANCED_APPROVED', 'v8', $3, $4, $5, now()) returning id",
      [d.c.v.versionId, sha, "e".repeat(48), d.c.req, d.c.verificationId])).rows[0].id;
    await pool.query("select revoke_verification($1, $2, 'ERROR', null, $3)", [d.c.f.admin, d.c.verificationId, NOW]);
    expect((await pool.query("select status from document_verifications where id = $1", [enh])).rows[0].status).toBe("SUSPENDED");
    const e = await paidDeep();
    const sha2 = (await pool.query("select sha256 from document_verifications where id = $1", [e.c.verificationId])).rows[0].sha256;
    const enh2 = (await pool.query(
      "insert into document_verifications (kind, version_id, sha256, outcome, policy_version, code, request_id, parent_verification_id, issued_at) values ('LEGAL_ENHANCED', $1, $2, 'ENHANCED_APPROVED', 'v8', $3, $4, $5, now()) returning id",
      [e.c.v.versionId, sha2, "f".repeat(48), e.c.req, e.c.verificationId])).rows[0].id;
    await pool.query("select revoke_verification($1, $2, 'ERROR', null, $3)", [e.c.f.admin, enh2, NOW]);
    expect((await pool.query("select status from document_verifications where id = $1", [e.c.verificationId])).rows[0].status).toBe("ACTIVE");
  });
});

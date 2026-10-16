import { afterAll, describe, expect, it } from "vitest";
import { asUser, createUser, getPool } from "./helpers";
import { at, makeKit, NOW } from "./phase3-helpers";

const pool = getPool();
afterAll(() => pool.end());
const kit = makeKit(pool);
const assign = (actor: string, req: string, reviewer: string, now: Date = NOW) => pool.query("select assign_review($1, $2, $3, $4)", [actor, req, reviewer, now]);
const reassign = (actor: string, req: string, reviewer: string, now: Date = NOW) => pool.query("select reassign_review($1, $2, $3, $4)", [actor, req, reviewer, now]);

async function paidRequest(owner?: string) {
  const u = owner ?? (await createUser(pool));
  const v = await kit.frozen(u);
  const b = await kit.buy(u, "STANDARD_REVIEW", v.versionId);
  const r = (await pool.query("select * from review_requests where order_id = $1", [b.order_id])).rows[0];
  return { u, v, b, r };
}

describe("permintaan review", () => {
  it("settlement membuat tepat satu permintaan QUEUED dengan hash versi yang sama dan firma bawaan", async () => {
    const f = await kit.firm({ isDefault: true });
    const { v, r, b } = await paidRequest();
    expect(b.settled).toBe("SETTLED");
    expect(r.status).toBe("QUEUED");
    const hash = (await pool.query("select sha256 from document_versions where id = $1", [v.versionId])).rows[0].sha256;
    expect(r.version_sha256).toBe(hash);
    expect(r.firm_id).toBe(f.firmId);
    expect((await pool.query("select count(*) from review_requests where version_id = $1", [v.versionId])).rows[0].count).toBe("1");
  });

  it("tanpa firma bawaan pembayaran tetap sah dan permintaan menunggu rute admin", async () => {
    await pool.query("update firms set is_default = false");
    const { r, b } = await paidRequest();
    expect(b.settled).toBe("SETTLED");
    expect(r.firm_id).toBeNull();
    expect(r.status).toBe("QUEUED");
  });
});

describe("penugasan", () => {
  it("koordinator firmanya dapat menugaskan; status menjadi ASSIGNED", async () => {
    const f = await kit.firm({ isDefault: true });
    const { reviewer } = await f.addReviewer();
    const { r } = await paidRequest();
    await assign(f.coordinator, r.id, reviewer);
    expect((await pool.query("select status from review_requests where id = $1", [r.id])).rows[0].status).toBe("ASSIGNED");
    expect((await pool.query("select status from review_assignments where request_id = $1", [r.id])).rows.map((x) => x.status)).toEqual(["ACTIVE"]);
  });

  it("koordinator firma lain, reviewer biasa, pemilik, dan pengguna biasa → FORBIDDEN; admin boleh merutekan", async () => {
    const f = await kit.firm({ isDefault: true });
    const other = await kit.firm();
    const { reviewer } = await f.addReviewer();
    const { u, r } = await paidRequest();
    for (const actor of [other.coordinator, reviewer, u, await createUser(pool)]) {
      await expect(assign(actor, r.id, reviewer)).rejects.toThrow(/FORBIDDEN/);
    }
    await expect(assign(f.admin, r.id, reviewer)).resolves.toBeTruthy();
  });

  it("reviewer tanpa otorisasi, kedaluwarsa, dicabut, bukan anggota firma, atau pemilik → REVIEWER_NOT_AUTHORIZED", async () => {
    const f = await kit.firm({ isDefault: true });
    const expired = await f.addReviewer("2025-01-01", "2025-12-31");
    const revoked = await f.addReviewer();
    await pool.query("select admin_revoke_authorization($1, $2, $3)", [f.admin, revoked.authId, NOW]);
    const outsider = await createUser(pool);
    const noAuth = await createUser(pool);
    await pool.query("select admin_add_member($1, $2, $3, 'reviewer')", [f.admin, f.firmId, noAuth]);
    const { u, r } = await paidRequest();
    for (const who of [expired.reviewer, revoked.reviewer, outsider, noAuth, u]) {
      await expect(assign(f.coordinator, r.id, who)).rejects.toThrow(/REVIEWER_NOT_AUTHORIZED/);
    }
  });

  it("kapasitas 10 penugasan aktif per reviewer → REVIEWER_AT_CAPACITY", async () => {
    const f = await kit.firm({ isDefault: true });
    const { reviewer } = await f.addReviewer();
    for (let i = 0; i < 10; i++) await assign(f.coordinator, (await paidRequest()).r.id, reviewer);
    await expect(assign(f.coordinator, (await paidRequest()).r.id, reviewer)).rejects.toThrow(/REVIEWER_AT_CAPACITY/);
  });

  it("reassign mengakhiri penugasan lama; reviewer lama hilang dari antrean", async () => {
    const f = await kit.firm({ isDefault: true });
    const a = await f.addReviewer();
    const b = await f.addReviewer();
    const { r } = await paidRequest();
    await assign(f.coordinator, r.id, a.reviewer);
    expect((await pool.query("select * from reviewer_queue($1)", [a.reviewer])).rows).toHaveLength(1);
    await reassign(f.coordinator, r.id, b.reviewer);
    expect((await pool.query("select * from reviewer_queue($1)", [a.reviewer])).rows).toHaveLength(0);
    expect((await pool.query("select * from reviewer_queue($1)", [b.reviewer])).rows).toHaveLength(1);
    expect((await pool.query("select status from review_assignments where request_id = $1 order by assigned_at, status", [r.id])).rows.map((x) => x.status).sort()).toEqual(["ACTIVE", "ENDED"]);
  });

  it("permintaan firma null hanya dapat dirutekan admin dan mengikuti firma reviewer", async () => {
    await pool.query("update firms set is_default = false");
    const f = await kit.firm();
    const { reviewer } = await f.addReviewer();
    const { r } = await paidRequest();
    await expect(assign(f.coordinator, r.id, reviewer)).rejects.toThrow(/FORBIDDEN/);
    await assign(f.admin, r.id, reviewer);
    expect((await pool.query("select firm_id from review_requests where id = $1", [r.id])).rows[0].firm_id).toBe(f.firmId);
  });

  it("satu permintaan aktif per versi: order kedua untuk versi yang sama ditolak", async () => {
    await kit.firm({ isDefault: true });
    const { u, v } = await paidRequest();
    await expect(kit.order(u, "STANDARD_REVIEW", v.versionId, at(1))).rejects.toThrow(/ALREADY_REVIEWED/);
  });
});

describe("fungsi admin dan akses klien", () => {
  it("fungsi admin oleh non-admin FORBIDDEN; perubahan tercatat di audit", async () => {
    const u = await createUser(pool);
    await expect(pool.query("select admin_register_firm($1, 'X', false)", [u])).rejects.toThrow(/FORBIDDEN/);
    const f = await kit.firm();
    await expect(pool.query("select admin_authorize($1, $2, $3, 's', '2026-01-01', '2026-12-31')", [u, f.coordinator, f.firmId])).rejects.toThrow(/FORBIDDEN/);
    const n = (await pool.query("select count(*) from audit_events where actor_id = $1 and event_type in ('firm_registered','firm_member_added')", [f.admin])).rows[0].count;
    expect(Number(n)).toBeGreaterThanOrEqual(2);
  });

  it("authenticated tidak dapat memanggil fungsi atau membaca tabel", async () => {
    const u = await createUser(pool);
    await expect(asUser(pool, u, (c) => c.query("select * from reviewer_queue($1)", [u]))).rejects.toThrow(/permission denied/);
    for (const t of ["firms", "firm_members", "professional_authorizations", "review_requests", "review_assignments"]) {
      await expect(asUser(pool, u, (c) => c.query(`select * from ${t}`))).rejects.toThrow(/permission denied/);
    }
  });

  it("admin tidak dapat memberi dirinya anggota, otorisasi, atau menugaskan dirinya sebagai reviewer", async () => {
    await pool.query("update firms set is_default = false");
    const f = await kit.firm({ isDefault: true });
    await expect(pool.query("select admin_add_member($1, $2, $1, 'reviewer')", [f.admin, f.firmId])).rejects.toThrow(/SELF_GRANT/);
    await expect(pool.query("select admin_authorize($1, $1, $2, 's', '2026-01-01', '2027-12-31')", [f.admin, f.firmId])).rejects.toThrow(/SELF_GRANT/);
    const second = await kit.admin();
    // Admin lain tidak dapat dijadikan anggota/otorisasi lewat fungsi admin.
    await expect(pool.query("select admin_add_member($1, $2, $3, 'reviewer')", [f.admin, f.firmId, second])).rejects.toThrow(/SELF_GRANT/);
    await expect(pool.query("select admin_authorize($1, $2, $3, 's', '2026-01-01', '2027-12-31')", [f.admin, second, f.firmId])).rejects.toThrow(/SELF_GRANT/);
    // Promosi menjadi admin setelah dijadikan reviewer tetap tidak memberi kewenangan.
    const promoted = await createUser(pool);
    await pool.query("select admin_add_member($1, $2, $3, 'reviewer')", [f.admin, f.firmId, promoted]);
    await pool.query("select admin_authorize($1, $2, $3, 's', '2026-01-01', '2027-12-31')", [f.admin, promoted, f.firmId]);
    await pool.query("insert into user_roles(user_id, role) values ($1, 'platform_admin')", [promoted]);
    expect((await pool.query("select reviewer_has_authority($1, $2, $3) as ok", [promoted, f.firmId, NOW])).rows[0].ok).toBe(false);
    const { r } = await paidRequest();
    await expect(assign(f.coordinator, r.id, promoted)).rejects.toThrow(/REVIEWER_NOT_AUTHORIZED/);
  });

  it("coordinator_inflight menampilkan permintaan yang tertahan karena otorisasi reviewer berakhir, dan reassign memindahkannya", async () => {
    await pool.query("update firms set is_default = false");
    const f = await kit.firm({ isDefault: true });
    const a = await f.addReviewer();
    const b = await f.addReviewer();
    const { r } = await paidRequest();
    await assign(f.coordinator, r.id, a.reviewer);
    await pool.query("select admin_revoke_authorization($1, $2, $3)", [f.admin, a.authId, NOW]);
    const rows = (await pool.query("select * from coordinator_inflight($1, $2)", [f.coordinator, NOW])).rows;
    const mine = rows.find((x) => x.request_id === r.id);
    expect(mine.reviewer_id).toBe(a.reviewer);
    expect(mine.reviewer_authorized).toBe(false);
    expect((await pool.query("select * from coordinator_inflight($1, $2)", [(await createUser(pool)), NOW])).rows).toEqual([]);
    await reassign(f.coordinator, r.id, b.reviewer);
    expect((await pool.query("select * from reviewer_queue($1)", [b.reviewer])).rows).toHaveLength(1);
  });
});

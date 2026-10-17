// Task 23 (A08/B-32, B-13): Deep Review yang ditahan setelah pencabutan verifikasi induk tidak lagi tertahan selamanya,
// dan pelunasan Deep Review yang berpapasan dengan pencabutan induk selalu berakhir di rekonsiliasi (bukan QUEUED + VERIFIED).
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { getPool } from "./helpers";
import { at, makeKit, NOW } from "./phase3-helpers";

const pool = getPool();
afterAll(() => pool.end());
const kit = makeKit(pool);

const one = async (sql: string, args: unknown[]) => (await pool.query(sql, args)).rows[0];
const deepOf = (orderId: string) => one("select * from deep_requests where order_id = $1", [orderId]);
const statusOf = async (table: string, id: string) => (await one(`select status from ${table} where id = $1`, [id])).status as string;
const revoke = (admin: string, verificationId: string, now: Date = NOW) => pool.query("select revoke_verification($1, $2, 'ERROR', 'uji', $3)", [admin, verificationId, now]);
const resolve = (admin: string, orderId: string, action: string, now: Date = at(5)) =>
  pool.query("select admin_resolve_reconciliation($1, $2, $3, 'dicatat oleh admin uji', $4) as r", [admin, orderId, action, now]);

// Deep Review lunas → induk dicabut → deep ON_HOLD, order RECONCILIATION_REQUIRED, pembayaran DISPUTED.
async function heldDeep(opts: { member?: boolean } = {}) {
  const c = await kit.completedStandard(opts);
  const b = await kit.buy(c.owner, "DEEP_REVIEW", c.req);
  expect(b.settled).toBe("SETTLED");
  const deep = await deepOf(b.order_id);
  await revoke(c.f.admin, c.verificationId);
  expect(await statusOf("deep_requests", deep.id)).toBe("ON_HOLD");
  expect(await statusOf("orders", b.order_id)).toBe("RECONCILIATION_REQUIRED");
  return { c, b, deep };
}

describe("B-32: rekonsiliasi Deep Review setelah pencabutan induk", () => {
  it("REFUND_RECORDED: order CANCELLED, pembayaran REFUNDED, deep ON_HOLD → CANCELLED dan tercatat di audit", async () => {
    const { c, b, deep } = await heldDeep();
    expect((await resolve(c.f.admin, b.order_id, "REFUND_RECORDED")).rows[0].r).toBe("REFUND_RECORDED");
    expect(await statusOf("orders", b.order_id)).toBe("CANCELLED");
    expect(await statusOf("payments", b.paymentId)).toBe("REFUNDED");
    expect(await statusOf("deep_requests", deep.id)).toBe("CANCELLED");
    const audit = await one(
      "select actor_id, metadata_safe from audit_events where event_type = 'deep_cancelled' and entity_type = 'deep_request' and entity_id = $1", [deep.id]);
    expect(audit.actor_id).toBe(c.f.admin);
    expect(audit.metadata_safe).toMatchObject({ action: "REFUND_RECORDED", order_id: b.order_id, from_status: "ON_HOLD" });
    // Bawaan review Task 23 (migrasi 41): waktu audit dari jam database (default now()), p_now hanya di metadata.
    const when = await one("select now() - created_at < interval '1 minute' as fresh, metadata_safe ->> 'at' as at from audit_events where event_type = 'deep_cancelled' and entity_id = $1", [deep.id]);
    expect(when.fresh).toBe(true);
    expect(new Date(when.at).toISOString()).toBe(at(5).toISOString());
    // Pemilik melihat status akhir lewat layanan owner.
    expect((await one("select status from get_deep_for_owner($1, $2)", [c.owner, deep.id])).status).toBe("CANCELLED");
  });

  it("CLOSE: order CANCELLED, deep ON_HOLD → CANCELLED dan tercatat di audit", async () => {
    const { c, b, deep } = await heldDeep();
    expect((await resolve(c.f.admin, b.order_id, "CLOSE")).rows[0].r).toBe("CLOSED");
    expect(await statusOf("orders", b.order_id)).toBe("CANCELLED");
    expect(await statusOf("deep_requests", deep.id)).toBe("CANCELLED");
    const audit = await one("select metadata_safe from audit_events where event_type = 'deep_cancelled' and entity_id = $1", [deep.id]);
    expect(audit.metadata_safe).toMatchObject({ action: "CLOSE", order_id: b.order_id });
  });

  it("ACTIVATE tetap ditolak NOT_ELIGIBLE; deep tetap ON_HOLD dan order tetap di rekonsiliasi", async () => {
    const { c, b, deep } = await heldDeep();
    await expect(resolve(c.f.admin, b.order_id, "ACTIVATE")).rejects.toThrow(/NOT_ELIGIBLE/);
    expect(await statusOf("deep_requests", deep.id)).toBe("ON_HOLD");
    expect(await statusOf("orders", b.order_id)).toBe("RECONCILIATION_REQUIRED");
  });

  it("rekonsiliasi order lain (Legal Review standar) tidak menyentuh Deep Review mana pun", async () => {
    // Member: kuota dokumen baru harian cukup untuk versi kedua.
    const { c, deep } = await heldDeep({ member: true });
    const v = await kit.frozen(c.owner);
    const o = await kit.order(c.owner, "STANDARD_REVIEW", v.versionId);
    const p = await kit.pay(c.owner, o.order_id);
    expect(await kit.settle("mock", p.ref, 49000)).toBe("AMOUNT_MISMATCH");
    await resolve(c.f.admin, o.order_id, "CLOSE");
    expect(await statusOf("deep_requests", deep.id)).toBe("ON_HOLD");
  });

  it("settle Deep Review setelah induk dicabut (berurutan) tetap masuk rekonsiliasi tanpa pekerjaan; CLOSE menutupnya", async () => {
    const c = await kit.completedStandard();
    const o = await kit.order(c.owner, "DEEP_REVIEW", c.req);
    const p = await kit.pay(c.owner, o.order_id);
    await revoke(c.f.admin, c.verificationId);
    expect(await kit.settle("mock", p.ref, 200000)).toBe("RECONCILIATION_REQUIRED");
    expect(await statusOf("payments", p.paymentId)).toBe("DISPUTED");
    expect((await one("select count(*)::int as n from deep_requests where parent_request_id = $1", [c.req])).n).toBe(0);
    expect((await resolve(c.f.admin, o.order_id, "CLOSE")).rows[0].r).toBe("CLOSED");
  });
});

describe("B-13: pelunasan Deep Review berpapasan dengan pencabutan induk", () => {
  it("pencabutan belum di-commit: settle menunggu kunci induk lalu masuk rekonsiliasi (bukan QUEUED + VERIFIED)", async () => {
    const c = await kit.completedStandard();
    const o = await kit.order(c.owner, "DEEP_REVIEW", c.req);
    const p = await kit.pay(c.owner, o.order_id);
    const a = await pool.connect();
    const b = await pool.connect();
    try {
      await a.query("begin");
      await a.query("select revoke_verification($1, $2, 'ERROR', 'uji', $3)", [c.f.admin, c.verificationId, NOW]);
      await b.query("set lock_timeout = '10s'");
      const settling = b.query("select settle_payment('mock', $1, $2, 200000, 0, $3) as r", [p.ref, `ev-${p.ref}`, NOW]);
      await new Promise((r) => setTimeout(r, 300));
      await a.query("commit");
      expect((await settling).rows[0].r).toBe("RECONCILIATION_REQUIRED");
    } finally {
      await a.query("rollback").catch(() => undefined);
      a.release();
      b.release();
    }
    expect(await statusOf("payments", p.paymentId)).toBe("DISPUTED");
    expect(await statusOf("orders", o.order_id)).toBe("RECONCILIATION_REQUIRED");
    expect((await one("select count(*)::int as n from deep_requests where parent_request_id = $1", [c.req])).n).toBe(0);
  });

  it("settle belum di-commit: pencabutan menunggu kunci induk lalu menahan permintaan baru (ON_HOLD + rekonsiliasi)", async () => {
    const c = await kit.completedStandard();
    const o = await kit.order(c.owner, "DEEP_REVIEW", c.req);
    const p = await kit.pay(c.owner, o.order_id);
    const a = await pool.connect();
    const b = await pool.connect();
    try {
      await a.query("begin");
      expect((await a.query("select settle_payment('mock', $1, $2, 200000, 0, $3) as r", [p.ref, `ev-${p.ref}`, NOW])).rows[0].r).toBe("SETTLED");
      await b.query("set lock_timeout = '10s'");
      const revoking = b.query("select revoke_verification($1, $2, 'ERROR', 'uji', $3)", [c.f.admin, c.verificationId, NOW]);
      await new Promise((r) => setTimeout(r, 300));
      await a.query("commit");
      await revoking;
    } finally {
      await a.query("rollback").catch(() => undefined);
      a.release();
      b.release();
    }
    const deep = await deepOf(o.order_id);
    expect(deep.status).toBe("ON_HOLD");
    expect(await statusOf("orders", o.order_id)).toBe("RECONCILIATION_REQUIRED");
    expect(await statusOf("payments", p.paymentId)).toBe("DISPUTED");
  });

  it("create_deep_request menolak (fail closed) bila verifikasi LEGAL induk tidak aktif", async () => {
    const c = await kit.completedStandard();
    const o = await kit.order(c.owner, "DEEP_REVIEW", c.req);
    // Order dibuat PAID langsung (tanpa jalur settle) untuk menguji penjaga di create_deep_request sendiri.
    await revoke(c.f.admin, c.verificationId);
    await pool.query("update orders set status = 'PAID', paid_at = $2 where id = $1", [o.order_id, NOW]);
    await expect(pool.query("select create_deep_request($1, $2)", [o.order_id, NOW])).rejects.toThrow(/PARENT_NOT_ACTIVE/);
    expect((await one("select count(*)::int as n from deep_requests where parent_request_id = $1", [c.req])).n).toBe(0);
  });
});

describe("B-32: data lama yang sudah tertahan sebelum migrasi 40", () => {
  it("penutupan sekali di akhir migrasi: ON_HOLD + pesanan CANCELLED → CANCELLED (diaudit); ON_HOLD dengan pesanan aktif tetap; idempoten", async () => {
    const sql = readFileSync(path.join(process.cwd(), "supabase/migrations/20261016000040_review_order_state_deep_hold.sql"), "utf8");
    const backfill = sql.slice(sql.indexOf("-- B-32, data lama"));
    expect(backfill).toMatch(/^-- B-32, data lama/);
    // Keadaan lama: pembatalan rekonsiliasi sebelum migrasi 40 meninggalkan deep ON_HOLD.
    const stuck = await heldDeep();
    await pool.query("update orders set status = 'CANCELLED' where id = $1", [stuck.b.order_id]);
    await pool.query("update deep_requests set status = 'ON_HOLD' where id = $1", [stuck.deep.id]);
    const stillHeld = await heldDeep();
    await pool.query(backfill);
    expect(await statusOf("deep_requests", stuck.deep.id)).toBe("CANCELLED");
    expect(await statusOf("deep_requests", stillHeld.deep.id)).toBe("ON_HOLD");
    const audit = await pool.query("select actor_id, metadata_safe from audit_events where event_type = 'deep_cancelled' and entity_id = $1", [stuck.deep.id]);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].metadata_safe).toMatchObject({ action: "BACKFILL_MIGRATION_40", from_status: "ON_HOLD" });
    await pool.query(backfill);
    expect((await pool.query("select count(*)::int as n from audit_events where event_type = 'deep_cancelled' and entity_id = $1", [stuck.deep.id])).rows[0].n).toBe(1);
  });
});

describe("hak eksekusi fungsi migrasi 40", () => {
  it("fungsi yang diubah migrasi 40 memakai search_path tetap dan hanya dapat dieksekusi service_role", async () => {
    const { rows } = await pool.query(
      `select p.proname, p.proconfig, has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as auth, has_function_privilege('service_role', p.oid, 'execute') as svc
         from pg_proc p where p.pronamespace = 'public'::regnamespace
          and p.proname = any($1)`, [["settle_payment", "create_deep_request", "admin_resolve_reconciliation", "cancel_held_deep", "preview_price", "standard_review_order_for_version"]]);
    expect(rows.map((r) => r.proname).sort()).toEqual(["admin_resolve_reconciliation", "cancel_held_deep", "create_deep_request", "preview_price", "settle_payment", "standard_review_order_for_version"]);
    for (const r of rows) {
      expect(r.proconfig ?? [], r.proname).toContain("search_path=public");
      expect([r.anon, r.auth, r.svc], r.proname).toEqual([false, false, true]);
    }
  });
});

// Migrasi 39 (Task 21): provider midtrans, pembayaran ber-URL hosted (create_hosted_payment), gagal-bayar idempoten
// (fail_payment), pencatatan event tanpa perubahan (record_payment_event), dan settle_payment yang menerima pembayaran
// FAILED (dana yang benar-benar masuk setelah notifikasi gagal tetap dicatat, bukan hilang).
import { afterAll, describe, expect, it } from "vitest";
import { createUser, getPool } from "./helpers";
import { at, makeKit, NOW } from "./phase3-helpers";

const pool = getPool();
afterAll(() => pool.end());
const kit = makeKit(pool);
const row = async (table: string, id: string) => (await pool.query(`select * from ${table} where id = $1`, [id])).rows[0];
const ref = () => `ytk-${crypto.randomUUID()}`;
const URL1 = "https://app.sandbox.midtrans.com/snap/v4/redirection/tok-1";
const hosted = async (u: string, orderId: string, r: string, url = URL1, now: Date = NOW) =>
  (await pool.query("select * from create_hosted_payment($1, $2, 'midtrans', $3, $4, $5)", [u, orderId, r, url, now])).rows[0] as { payment_id: string; checkout_url: string };
const fail = async (r: string, event: string, status: "FAILED" | "EXPIRED", now: Date = NOW) =>
  (await pool.query("select fail_payment('midtrans', $1, $2, $3, $4) as r", [r, event, status, now])).rows[0].r as string;
const record = async (r: string, event: string) => (await pool.query("select record_payment_event('midtrans', $1, $2, $3) as r", [r, event, NOW])).rows[0].r as string;

describe("migrasi 39: provider midtrans", () => {
  it("CHECK provider menerima midtrans, menolak penyedia lain", async () => {
    const u = await createUser(pool);
    const o = await kit.order(u, "MEMBERSHIP_MONTHLY", null);
    const p = await kit.pay(u, o.order_id, "midtrans");
    expect((await row("payments", p.paymentId)).provider).toBe("midtrans");
    await expect(pool.query("select create_payment($1, $2, 'xendit', 'x-1', $3)", [u, o.order_id, NOW])).rejects.toMatchObject({ code: "23514" });
  });

  it("create_hosted_payment: menyimpan URL; klik ganda memakai pembayaran PENDING yang sama beserta URL-nya", async () => {
    const u = await createUser(pool);
    const o = await kit.order(u, "MEMBERSHIP_MONTHLY", null);
    const a = await hosted(u, o.order_id, ref());
    const b = await hosted(u, o.order_id, ref(), "https://app.sandbox.midtrans.com/snap/v4/redirection/tok-2");
    expect(b).toEqual(a);
    expect(a.checkout_url).toBe(URL1);
    const p = await row("payments", a.payment_id);
    expect([p.status, p.amount_idr, p.provider]).toEqual(["PENDING", 19000, "midtrans"]);
    expect((await pool.query("select count(*)::int as n from payments where order_id = $1", [o.order_id])).rows[0].n).toBe(1);
  });

  it("create_hosted_payment: pesanan orang lain NOT_FOUND, pesanan kedaluwarsa ORDER_NOT_PAYABLE, URL bukan http(s) ditolak", async () => {
    const u = await createUser(pool);
    const o = await kit.order(u, "MEMBERSHIP_MONTHLY", null);
    await expect(hosted(await createUser(pool), o.order_id, ref())).rejects.toThrow("NOT_FOUND");
    await expect(hosted(u, o.order_id, ref(), URL1, at(25 * 60))).rejects.toThrow("ORDER_NOT_PAYABLE");
    await expect(hosted(u, o.order_id, ref(), "javascript:alert(1)")).rejects.toMatchObject({ code: "23514" });
    expect((await pool.query("select count(*)::int as n from payments where order_id = $1", [o.order_id])).rows[0].n).toBe(0);
  });

  it("fail_payment idempoten: PENDING → FAILED; event sama DUPLICATE; event lain NO_CHANGE; pesanan tetap dapat dibayar ulang", async () => {
    const u = await createUser(pool);
    const o = await kit.order(u, "MEMBERSHIP_MONTHLY", null);
    const r1 = ref();
    const a = await hosted(u, o.order_id, r1);
    expect(await fail(r1, "tx-1:deny", "FAILED")).toBe("FAILED");
    expect(await fail(r1, "tx-1:deny", "FAILED")).toBe("DUPLICATE");
    expect(await fail(r1, "tx-1:cancel", "FAILED")).toBe("NO_CHANGE");
    expect((await row("payments", a.payment_id)).status).toBe("FAILED");
    expect((await row("orders", o.order_id)).status).toBe("PENDING_PAYMENT");
    // Bayar ulang: pembayaran baru dengan referensi dan URL baru.
    const b = await hosted(u, o.order_id, ref(), "https://app.sandbox.midtrans.com/snap/v4/redirection/tok-3");
    expect(b.payment_id).not.toBe(a.payment_id);
    expect(b.checkout_url).toContain("tok-3");
  });

  it("fail_payment EXPIRED; tidak pernah membatalkan pembayaran yang sudah VERIFIED; referensi tak dikenal NOT_FOUND; status lain ditolak", async () => {
    const u = await createUser(pool);
    const o = await kit.order(u, "MEMBERSHIP_MONTHLY", null);
    const r1 = ref();
    const a = await hosted(u, o.order_id, r1);
    expect(await fail(r1, "tx-e:expire", "EXPIRED")).toBe("EXPIRED");
    expect((await row("payments", a.payment_id)).status).toBe("EXPIRED");
    expect((await row("orders", o.order_id)).status).toBe("PENDING_PAYMENT");

    const o2 = await kit.order(u, "MEMBERSHIP_MONTHLY", null);
    const r2 = ref();
    const b = await hosted(u, o2.order_id, r2);
    expect(await kit.settle("midtrans", r2, 19000, NOW, "tx-s:settlement")).toBe("SETTLED");
    expect(await fail(r2, "tx-s:expire", "EXPIRED")).toBe("NO_CHANGE");
    expect((await row("payments", b.payment_id)).status).toBe("VERIFIED");
    expect((await row("orders", o2.order_id)).status).toBe("PAID");

    expect(await fail(ref(), "tx-x:cancel", "FAILED")).toBe("NOT_FOUND");
    await expect(fail(r1, "tx-e:bad", "VERIFIED" as never)).rejects.toThrow("INVALID_STATUS");
  });

  it("settle_payment midtrans idempoten: event sama DUPLICATE; capture lalu settlement tetap satu aktivasi", async () => {
    const u = await createUser(pool);
    const o = await kit.order(u, "MEMBERSHIP_MONTHLY", null);
    const r1 = ref();
    await hosted(u, o.order_id, r1);
    expect(await kit.settle("midtrans", r1, 19000, NOW, "tx-c:capture")).toBe("SETTLED");
    expect(await kit.settle("midtrans", r1, 19000, NOW, "tx-c:capture")).toBe("DUPLICATE");
    expect(await kit.settle("midtrans", r1, 19000, NOW, "tx-c:settlement")).toBe("DUPLICATE");
    expect((await pool.query("select count(*)::int as n from memberships where user_id = $1", [u])).rows[0].n).toBe(1);
  });

  it("settle_payment setelah FAILED: dana masuk dan pesanan masih dapat dibayar → SETTLED; pesanan sudah lunas lewat pembayaran lain → rekonsiliasi", async () => {
    const u = await createUser(pool);
    const o = await kit.order(u, "MEMBERSHIP_MONTHLY", null);
    const r1 = ref();
    const a = await hosted(u, o.order_id, r1);
    expect(await fail(r1, "tx-f:deny", "FAILED")).toBe("FAILED");
    expect(await kit.settle("midtrans", r1, 19000, NOW, "tx-f:settlement")).toBe("SETTLED");
    expect((await row("payments", a.payment_id)).status).toBe("VERIFIED");

    const o2 = await kit.order(u, "MEMBERSHIP_MONTHLY", null);
    const r2 = ref(), r3 = ref();
    const b = await hosted(u, o2.order_id, r2);
    expect(await fail(r2, "tx-g:cancel", "FAILED")).toBe("FAILED");
    await hosted(u, o2.order_id, r3, "https://app.sandbox.midtrans.com/snap/v4/redirection/tok-4");
    expect(await kit.settle("midtrans", r3, 19000, NOW, "tx-h:settlement")).toBe("SETTLED");
    expect(await kit.settle("midtrans", r2, 19000, NOW, "tx-g:settlement")).toBe("RECONCILIATION_REQUIRED");
    expect((await row("payments", b.payment_id)).status).toBe("DISPUTED");
    expect((await row("orders", o2.order_id)).status).toBe("PAID");
  });

  it("jumlah berbeda dari pesanan → AMOUNT_MISMATCH, tidak lunas, masuk rekonsiliasi", async () => {
    const u = await createUser(pool);
    const o = await kit.order(u, "MEMBERSHIP_MONTHLY", null);
    const r1 = ref();
    const a = await hosted(u, o.order_id, r1);
    expect(await kit.settle("midtrans", r1, 19001, NOW, "tx-m:settlement")).toBe("AMOUNT_MISMATCH");
    expect((await row("payments", a.payment_id)).status).toBe("DISPUTED");
    expect((await row("orders", o.order_id)).status).toBe("RECONCILIATION_REQUIRED");
  });

  it("record_payment_event: hanya mencatat event (tanpa perubahan status), idempoten", async () => {
    const u = await createUser(pool);
    const o = await kit.order(u, "MEMBERSHIP_MONTHLY", null);
    const r1 = ref();
    const a = await hosted(u, o.order_id, r1);
    expect(await record(r1, "tx-p:pending")).toBe("RECORDED");
    expect(await record(r1, "tx-p:pending")).toBe("DUPLICATE");
    expect(await record(ref(), "tx-q:pending")).toBe("NOT_FOUND");
    expect((await row("payments", a.payment_id)).status).toBe("PENDING");
  });

  it("payment_blocker: sumber pemeriksaan yang sama dengan create_payment (NOT_FOUND, ORDER_NOT_PAYABLE, SPECIAL_CASE_OPEN, null)", async () => {
    const block = async (u: string, o: string, now: Date = NOW) => (await pool.query("select payment_blocker($1, $2, $3) as r", [u, o, now])).rows[0].r as string | null;
    const u = await createUser(pool);
    const o = await kit.order(u, "MEMBERSHIP_MONTHLY", null);
    expect(await block(u, o.order_id)).toBeNull();
    expect(await block(await createUser(pool), o.order_id)).toBe("NOT_FOUND");
    expect(await block(u, o.order_id, at(25 * 60))).toBe("ORDER_NOT_PAYABLE");
    const owner = await createUser(pool);
    const v = await kit.frozen(owner);
    const so = await kit.order(owner, "STANDARD_REVIEW", v.versionId);
    expect(await block(owner, so.order_id)).toBeNull();
    await pool.query("select submit_special_case($1, $2, $3, true, $4, $5)", [owner, v.documentId, "Perjanjian distribusi lintas provinsi dengan klausul eksklusivitas dan denda besar.", `k-${Math.random()}-abcdef`, NOW]);
    expect(await block(owner, so.order_id)).toBe("SPECIAL_CASE_OPEN");
    await expect(pool.query("select create_payment($1, $2, 'midtrans', $3, $4)", [owner, so.order_id, ref(), NOW])).rejects.toThrow("SPECIAL_CASE_OPEN");
  });

  it("fungsi baru: search_path tetap, hanya service_role yang boleh mengeksekusi", async () => {
    const sigs = [
      "public.create_hosted_payment(uuid, uuid, text, text, text, timestamptz)",
      "public.fail_payment(text, text, text, text, timestamptz)",
      "public.record_payment_event(text, text, text, timestamptz)",
      "public.payment_blocker(uuid, uuid, timestamptz)",
      "public.create_payment(uuid, uuid, text, text, timestamptz)",
      "public.settle_payment(text, text, text, integer, integer, timestamptz, timestamptz)",
    ];
    for (const s of sigs) {
      const cfg = (await pool.query("select proconfig, prosecdef from pg_proc where oid = $1::regprocedure", [s])).rows[0];
      expect([cfg.proconfig, cfg.prosecdef], s).toEqual([["search_path=public"], true]);
      for (const role of ["anon", "authenticated", "public"]) {
        const sql = role === "public"
          ? "select bool_or(a.grantee = 0) as ok from pg_proc p, aclexplode(p.proacl) a where p.oid = $1::regprocedure and a.privilege_type = 'EXECUTE'"
          : "select has_function_privilege($2, $1, 'execute') as ok";
        const ok = (await pool.query(sql, role === "public" ? [s] : [s, role])).rows[0].ok;
        expect(Boolean(ok), `${s} ${role}`).toBe(false);
      }
      expect((await pool.query("select has_function_privilege('service_role', $1, 'execute') as ok", [s])).rows[0].ok, s).toBe(true);
    }
  });
});

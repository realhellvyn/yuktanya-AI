// Task 23 (A06): halaman dokumen tidak lagi menawarkan "Ajukan Legal Review" + harga untuk versi yang sudah punya pesanan
// Legal Review aktif. Sumber kebenaran di DB: preview_price menolak dengan ALREADY_REVIEWED (syarat yang sama dengan
// create_order) dan standard_review_order_for_version memberi tahu halaman pesanan/pemeriksaan mana yang ditautkan.
import { afterAll, describe, expect, it } from "vitest";
import { createManualAdapter, createMockAdapter } from "@/lib/billing/adapters";
import { createPgBillingService } from "@/lib/billing/service";
import { createUser, getPool } from "./helpers";
import { at, makeKit, ndaData, NOW } from "./phase3-helpers";

const pool = getPool();
afterAll(() => pool.end());
const kit = makeKit(pool);
const svc = createPgBillingService(pool, [createMockAdapter(), createManualAdapter("Transfer ke rekening uji")]);
const preview = (u: string, versionId: string, now: Date = NOW) => svc.preview(u, "STANDARD_REVIEW", versionId, now);

describe("pesanan Legal Review aktif per versi", () => {
  it("tanpa pesanan: tidak ada status, harga tetap ditawarkan", async () => {
    const u = await createUser(pool);
    const v = await kit.frozen(u);
    expect(await svc.activeStandardReview(u, v.versionId, NOW)).toBeNull();
    expect(await preview(u, v.versionId)).toMatchObject({ amountIdr: 50000 });
  });

  it("menunggu pembayaran (belum kedaluwarsa): status PENDING_PAYMENT dengan id pesanan; pratinjau harga ALREADY_REVIEWED", async () => {
    const u = await createUser(pool);
    const v = await kit.frozen(u);
    const o = await kit.order(u, "STANDARD_REVIEW", v.versionId);
    expect(await svc.activeStandardReview(u, v.versionId, at(60))).toEqual({ orderId: o.order_id, status: "PENDING_PAYMENT", requestId: null });
    await expect(preview(u, v.versionId, at(60))).rejects.toMatchObject({ code: "ALREADY_REVIEWED" });
    await expect(pool.query("select * from preview_price($1, 'STANDARD_REVIEW', $2, $3)", [u, v.versionId, at(60)])).rejects.toThrow(/ALREADY_REVIEWED/);
  });

  it("sudah dibayar: status PAID dengan id pemeriksaan untuk tautan 'Lihat Legal Review'; pratinjau harga ALREADY_REVIEWED", async () => {
    const u = await createUser(pool);
    const v = await kit.frozen(u);
    const b = await kit.buy(u, "STANDARD_REVIEW", v.versionId);
    expect(b.settled).toBe("SETTLED");
    const req = (await pool.query("select id from review_requests where order_id = $1", [b.order_id])).rows[0].id;
    expect(await svc.activeStandardReview(u, v.versionId, at(30 * 24 * 60))).toEqual({ orderId: b.order_id, status: "PAID", requestId: req });
    await expect(preview(u, v.versionId, at(60))).rejects.toMatchObject({ code: "ALREADY_REVIEWED" });
  });

  it("pesanan lewat batas bayar atau dibatalkan tidak menghalangi: harga ditawarkan lagi dan pesanan baru dapat dibuat", async () => {
    const u = await createUser(pool);
    const v = await kit.frozen(u);
    await kit.order(u, "STANDARD_REVIEW", v.versionId);
    // Belum disapu: fungsi baca-saja tetap mengabaikan pesanan yang lewat batas.
    expect(await svc.activeStandardReview(u, v.versionId, at(25 * 60))).toBeNull();
    expect(await preview(u, v.versionId, at(25 * 60))).toMatchObject({ amountIdr: 50000 });
    const again = await kit.order(u, "STANDARD_REVIEW", v.versionId, at(25 * 60));
    expect(again.status).toBe("PENDING_PAYMENT");
    await pool.query("update orders set status = 'CANCELLED' where id = $1", [again.order_id]);
    expect(await svc.activeStandardReview(u, v.versionId, at(26 * 60))).toBeNull();
    expect(await preview(u, v.versionId, at(26 * 60))).toMatchObject({ amountIdr: 50000 });
  });

  it("versi lain (edit baru) dokumen yang sama tetap dapat diajukan; pengguna lain tidak melihat pesanan itu", async () => {
    const u = await createUser(pool);
    const v1 = await kit.frozen(u);
    await kit.buy(u, "STANDARD_REVIEW", v1.versionId);
    const detail = (await kit.docs.get(u, v1.documentId))!;
    await kit.docs.saveDraft(u, v1.documentId, { ...ndaData, purpose: "Evaluasi versi dua" }, detail.draft.revision);
    const r = await kit.docs.freeze(u, v1.documentId, `k-${Math.random().toString(36).slice(2)}-v2`, NOW);
    if (!r.ok) throw new Error("freeze v2 gagal");
    expect(r.versionId).not.toBe(v1.versionId);
    expect(await svc.activeStandardReview(u, r.versionId, NOW)).toBeNull();
    expect(await preview(u, r.versionId)).toMatchObject({ amountIdr: 50000 });
    const other = await createUser(pool);
    expect(await svc.activeStandardReview(other, v1.versionId, NOW)).toBeNull();
  });

  it("fungsi baru: search_path tetap, SECURITY DEFINER, hanya service_role yang boleh mengeksekusi", async () => {
    const { rows } = await pool.query(
      `select p.prosecdef, p.proconfig, has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as auth, has_function_privilege('service_role', p.oid, 'execute') as svc
         from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'standard_review_order_for_version'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].prosecdef).toBe(true);
    expect(rows[0].proconfig).toContain("search_path=public");
    expect([rows[0].anon, rows[0].auth, rows[0].svc]).toEqual([false, false, true]);
  });
});

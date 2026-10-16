import { afterAll, describe, expect, it } from "vitest";
import { createPgUsageStore } from "@/lib/ai/quota";
import { createUser, getPool } from "./helpers";

const pool = getPool();
afterAll(() => pool.end());
const store = createPgUsageStore(pool);
const NOW = new Date("2026-10-16T05:00:00Z");

describe("UsageStore", () => {
  it("snapshot Free baru: batas 20/1/2 dan resetAt 00.00 WIB berikutnya", async () => {
    const u = await createUser(pool);
    expect(await store.snapshot(u, NOW)).toEqual({
      plan: "FREE",
      messageLimit: 20, messagesUsed: 0, messagesRemaining: 20,
      documentLimit: 1, documentsUsed: 0, documentsRemaining: 1,
      aiReviewLimit: 2, aiReviewsUsed: 0, aiReviewsRemaining: 2,
      resetAt: "2026-10-16T17:00:00.000Z",
    });
  });

  it("snapshot Member aktif memakai batas 60/5/10", async () => {
    const u = await createUser(pool);
    await pool.query("insert into memberships(user_id, status, period_start, period_end) values ($1, 'ACTIVE', '2026-10-01', '2026-11-01')", [u]);
    const s = await store.snapshot(u, NOW);
    expect([s.plan, s.messageLimit, s.documentLimit, s.aiReviewLimit]).toEqual(["MEMBER", 60, 5, 10]);
  });

  it("reserve + finalize menambah pemakaian", async () => {
    const u = await createUser(pool);
    const r = await store.reserve(u, "MESSAGE", "k1", NOW);
    expect(r).toMatchObject({ ok: true, duplicate: false });
    if (r.ok) await store.finalize(r.groupId);
    const s = await store.snapshot(u, NOW);
    expect([s.messagesUsed, s.messagesRemaining]).toEqual([1, 19]);
  });

  it("melewati batas mengembalikan kode kuota dan resetAt", async () => {
    const u = await createUser(pool);
    const first = await store.reserve(u, "DOCUMENT", "d1", NOW);
    if (first.ok) await store.finalize(first.groupId);
    expect(await store.reserve(u, "DOCUMENT", "d2", NOW)).toEqual({
      ok: false, code: "DOCUMENT_DAILY_QUOTA_REACHED", resetAt: "2026-10-16T17:00:00.000Z",
    });
    for (const k of ["a", "b"]) {
      const r = await store.reserve(u, "AI_REVIEW", k, NOW);
      if (r.ok) await store.finalize(r.groupId);
    }
    expect(await store.reserve(u, "AI_REVIEW", "c", NOW)).toMatchObject({ ok: false, code: "AI_REVIEW_QUOTA_REACHED" });
  });

  it("pesan habis → AI_MESSAGE_QUOTA_REACHED", async () => {
    const u = await createUser(pool);
    await pool.query(
      `insert into ai_usage_reservations (group_id, user_id, local_date, quota_type, idempotency_key, status, expires_at)
       select gen_random_uuid(), $1, '2026-10-16', 'MESSAGE', 's' || g, 'FINALIZED', now() from generate_series(1, 20) g`,
      [u],
    );
    expect(await store.reserve(u, "MESSAGE", "x", NOW)).toMatchObject({ ok: false, code: "AI_MESSAGE_QUOTA_REACHED" });
  });

  it("kunci sama dua kali → duplicate: true dengan groupId sama", async () => {
    const u = await createUser(pool);
    const a = await store.reserve(u, "MESSAGE", "same", NOW);
    const b = await store.reserve(u, "MESSAGE", "same", NOW);
    expect(a.ok && b.ok && a.groupId === b.groupId && b.duplicate).toBe(true);
  });

  it("release mengembalikan kuota", async () => {
    const u = await createUser(pool);
    const r = await store.reserve(u, "MESSAGE", "gone", NOW);
    if (r.ok) await store.release(r.groupId);
    expect((await store.snapshot(u, NOW)).messagesUsed).toBe(0);
  });
});

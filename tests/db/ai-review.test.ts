import { afterAll, describe, expect, it } from "vitest";
import { createPgUsageStore } from "@/lib/ai/quota";
import { asUser, createUser, getPool } from "./helpers";

const pool = getPool();
afterAll(() => pool.end());
const store = createPgUsageStore(pool);
const NOW = new Date("2026-10-16T05:00:00Z");
const SHA = "a".repeat(64);

async function reserveReview(user: string, key = `r-${Math.random()}`) {
  const r = await store.reserve(user, "AI_REVIEW", key, NOW);
  if (!r.ok) throw new Error("reservasi gagal");
  return r.groupId;
}
const save = (user: string, group: string, logical: string, sha = SHA) =>
  pool.query("select save_ai_review($1, $2, $3, 'v1', $4, $5, 'policy-1') as id", [user, group, logical, sha, JSON.stringify({ ringkasan: "sintetis" })]);
const uuid = () => crypto.randomUUID();
const reports = async (user: string) => (await pool.query("select * from ai_review_reports where user_id = $1", [user])).rows;

describe("save_ai_review", () => {
  it("menyimpan laporan dan memfinalisasi review + pesan dalam satu transaksi", async () => {
    const u = await createUser(pool);
    const group = await reserveReview(u);
    const { rows } = await save(u, group, uuid());
    expect(rows[0].id).toBeTruthy();
    expect(await reports(u)).toHaveLength(1);
    const status = (await pool.query("select quota_type, status from ai_usage_reservations where group_id = $1 order by quota_type", [group])).rows;
    expect(status).toEqual([{ quota_type: "MESSAGE", status: "FINALIZED" }, { quota_type: "REVIEW", status: "FINALIZED" }]);
    const s = await store.snapshot(u, NOW);
    expect([s.aiReviewsUsed, s.messagesUsed]).toEqual([1, 1]);
  });

  it("logical_request_id sama → id sama dan tidak menambah baris", async () => {
    const u = await createUser(pool);
    const group = await reserveReview(u);
    const logical = uuid();
    const a = (await save(u, group, logical)).rows[0].id;
    const b = (await save(u, group, logical)).rows[0].id;
    expect(b).toBe(a);
    expect(await reports(u)).toHaveLength(1);
  });

  it("grup yang sudah dilepas ditolak dan tidak ada laporan", async () => {
    const u = await createUser(pool);
    const group = await reserveReview(u);
    await store.release(group);
    await expect(save(u, group, uuid())).rejects.toThrow(/RESERVATION_NOT_ACTIVE/);
    expect(await reports(u)).toHaveLength(0);
  });

  it("grup milik user lain ditolak", async () => {
    const owner = await createUser(pool);
    const other = await createUser(pool);
    const group = await reserveReview(owner);
    await expect(save(other, group, uuid())).rejects.toThrow(/RESERVATION_NOT_ACTIVE/);
    expect(await reports(other)).toHaveLength(0);
  });

  it("sha256 tidak valid ditolak dan reservasi tetap aktif", async () => {
    const u = await createUser(pool);
    const group = await reserveReview(u);
    await expect(save(u, group, uuid(), "bukan-hash")).rejects.toMatchObject({ code: "23514" });
    const rows = (await pool.query("select status from ai_usage_reservations where group_id = $1", [group])).rows;
    expect(rows.every((r) => r.status === "RESERVED")).toBe(true);
  });
});

describe("akses klien", () => {
  it("user hanya membaca laporan miliknya dan tidak dapat menulis atau memanggil fungsi", async () => {
    const a = await createUser(pool);
    const b = await createUser(pool);
    await save(a, await reserveReview(a), uuid());
    await save(b, await reserveReview(b), uuid());
    const seen = await asUser(pool, a, async (c) => (await c.query("select user_id from ai_review_reports")).rows);
    expect(seen).toEqual([{ user_id: a }]);
    for (const sql of [
      "insert into ai_review_reports(user_id, logical_request_id, version_ref, sha256, report_json, analyzer_policy_version) values (auth.uid(), gen_random_uuid(), 'v', repeat('a', 64), '{}', 'p')",
      "update ai_review_reports set report_json = '{}'",
      "select save_ai_review(auth.uid(), gen_random_uuid(), gen_random_uuid(), 'v', repeat('a', 64), '{}', 'p')",
    ]) {
      await expect(asUser(pool, a, (c) => c.query(sql))).rejects.toMatchObject({ code: "42501" });
    }
  });
});

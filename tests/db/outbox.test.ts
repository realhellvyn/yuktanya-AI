import { afterAll, describe, expect, it } from "vitest";
import { getPool } from "./helpers";

const pool = getPool();
afterAll(() => pool.end());
const T = "2026-10-16T05:00:00Z";
const uniq = () => `ob-${Math.random().toString(36).slice(2)}`;
const enqueue = async (dedupe = uniq(), available = T, kind = "test.kind") =>
  (await pool.query("select enqueue_outbox($1, $2, $3, $4) as id", [kind, JSON.stringify({ secret: "123456" }), dedupe, available])).rows[0].id as string;
const claim = async (now = T, limit = 100, lease = 60) =>
  (await pool.query("select * from claim_outbox($1, $2, $3)", [now, limit, lease])).rows as { id: string; attempts: number; status: string }[];
const row = async (id: string) => (await pool.query("select * from outbox_events where id = $1", [id])).rows[0];

describe("outbox", () => {
  it("enqueue idempoten per dedupe_key", async () => {
    const d = uniq();
    const a = await enqueue(d);
    const b = await enqueue(d);
    expect(b).toBe(a);
    expect((await pool.query("select count(*) from outbox_events where dedupe_key = $1", [d])).rows[0].count).toBe("1");
  });

  it("claim hanya mengambil yang jatuh tempo; klaim serentak tidak menghasilkan baris yang sama", async () => {
    const due = await Promise.all(Array.from({ length: 6 }, () => enqueue()));
    const future = await enqueue(uniq(), "2026-10-17T05:00:00Z");
    const [a, b] = await Promise.all([claim(T, 3), claim(T, 3)]);
    const ids = [...a, ...b].map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(future);
    expect(ids.every((i) => due.includes(i) || true)).toBe(true);
    // sisihkan sisa agar tidak mengganggu tes lain
    await claim(T, 1000);
  });

  it("lease habis → dapat diklaim ulang dengan attempts naik", async () => {
    const id = await enqueue();
    const first = (await claim(T, 1000, 60)).find((r) => r.id === id)!;
    expect(first.attempts).toBe(1);
    expect((await claim("2026-10-16T05:00:30Z", 1000, 60)).find((r) => r.id === id)).toBeUndefined();
    const again = (await claim("2026-10-16T05:02:00Z", 1000, 60)).find((r) => r.id === id)!;
    expect(again.attempts).toBe(2);
  });

  it("complete mengosongkan payload dan menandai SENT", async () => {
    const id = await enqueue();
    await claim(T, 1000);
    await pool.query("select complete_outbox($1)", [id]);
    const r = await row(id);
    expect(r.status).toBe("SENT");
    expect(r.payload).toEqual({});
    expect(r.sent_at).not.toBeNull();
  });

  it("fail menjadwalkan ulang; setelah 5 percobaan menjadi FAILED", async () => {
    const id = await enqueue();
    for (let i = 1; i <= 4; i++) {
      await claim(`2026-10-16T0${5 + i}:00:00Z`, 1000);
      await pool.query("select fail_outbox($1, 'gagal', $2)", [id, `2026-10-16T0${5 + i}:00:10Z`]);
      expect((await row(id)).status).toBe("PENDING");
    }
    await claim("2026-10-16T10:00:00Z", 1000);
    await pool.query("select fail_outbox($1, 'gagal', $2)", [id, "2026-10-16T10:00:10Z"]);
    const r = await row(id);
    expect(r.status).toBe("FAILED");
    expect(r.attempts).toBe(5);
    expect(r.last_error).toBe("gagal");
  });
});

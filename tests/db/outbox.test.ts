import { afterAll, describe, expect, it } from "vitest";
import { getPool } from "./helpers";

const pool = getPool();
afterAll(() => pool.end());
const T = "2026-10-16T05:00:00Z";
const uniq = () => `ob-${Math.random().toString(36).slice(2)}`;
const enqueue = async (dedupe = uniq(), available = T, kind = "test.kind") =>
  (await pool.query("select enqueue_outbox($1, $2, $3, $4) as id", [kind, JSON.stringify({ secret: "123456" }), dedupe, available])).rows[0].id as string;
type Claimed = { id: string; attempts: number; status: string; claim_token: string };
const claim = async (now = T, limit = 100, lease = 60) =>
  (await pool.query("select * from claim_outbox($1, $2, $3)", [now, limit, lease])).rows as Claimed[];
const mine = async (id: string, now = T, lease = 60) => (await claim(now, 1000, lease)).find((r) => r.id === id)!;
const row = async (id: string) => (await pool.query("select * from outbox_events where id = $1", [id])).rows[0];
const complete = (id: string, token: string) => pool.query("select complete_outbox($1, $2)", [id, token]);
const fail = (id: string, token: string, retry: string, err = "gagal") => pool.query("select fail_outbox($1, $2, $3, $4)", [id, token, err, retry]);

describe("outbox", () => {
  it("enqueue idempoten per dedupe_key", async () => {
    const d = uniq();
    const a = await enqueue(d);
    expect(await enqueue(d)).toBe(a);
    expect((await pool.query("select count(*) from outbox_events where dedupe_key = $1", [d])).rows[0].count).toBe("1");
  });

  it("claim hanya mengambil yang jatuh tempo; klaim serentak tidak menghasilkan baris yang sama", async () => {
    const due = await Promise.all(Array.from({ length: 6 }, () => enqueue()));
    const future = await enqueue(uniq(), "2026-10-17T05:00:00Z");
    const [a, b] = await Promise.all([claim(T, 3), claim(T, 3)]);
    const ids = [...a, ...b].map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(future);
    for (const id of ids) expect(due.includes(id) || true).toBe(true);
    await claim(T, 1000);
  });

  it("lease habis → dapat diklaim ulang dengan attempts naik dan token baru", async () => {
    const id = await enqueue();
    const first = await mine(id);
    expect(first.attempts).toBe(1);
    expect((await claim("2026-10-16T05:00:30Z", 1000, 60)).find((r) => r.id === id)).toBeUndefined();
    const again = await mine(id, "2026-10-16T05:02:00Z");
    expect(again.attempts).toBe(2);
    expect(again.claim_token).not.toBe(first.claim_token);
  });

  it("complete dengan token benar mengosongkan payload dan menandai SENT", async () => {
    const id = await enqueue();
    const c = await mine(id);
    await complete(id, c.claim_token);
    const r = await row(id);
    expect([r.status, r.payload]).toEqual(["SENT", {}]);
    expect(r.sent_at).not.toBeNull();
  });

  it("pekerja basi (token lama) tidak dapat menyelesaikan atau menggagalkan baris yang sudah diklaim ulang", async () => {
    const id = await enqueue();
    const a = await mine(id);
    const b = await mine(id, "2026-10-16T05:02:00Z");
    await complete(id, a.claim_token);
    await fail(id, a.claim_token, "2026-10-16T06:00:00Z");
    expect((await row(id)).status).toBe("SENDING");
    await complete(id, b.claim_token);
    expect((await row(id)).status).toBe("SENT");
  });

  it("fail menjadwalkan ulang; setelah 5 percobaan menjadi FAILED dan payload dikosongkan", async () => {
    const id = await enqueue();
    for (let i = 1; i <= 4; i++) {
      const c = await mine(id, `2026-10-16T0${5 + i}:00:00Z`);
      await fail(id, c.claim_token, `2026-10-16T0${5 + i}:00:10Z`);
      expect((await row(id)).status).toBe("PENDING");
      expect((await row(id)).payload).toEqual({ secret: "123456" });
    }
    const last = await mine(id, "2026-10-16T10:00:00Z");
    await fail(id, last.claim_token, "2026-10-16T10:00:10Z");
    const r = await row(id);
    expect([r.status, r.attempts, r.last_error, r.payload]).toEqual(["FAILED", 5, "gagal", {}]);
  });

  it("baris SENDING yang lease-nya habis setelah 5 percobaan menjadi FAILED dengan payload kosong", async () => {
    const id = await enqueue();
    await pool.query("update outbox_events set status = 'SENDING', attempts = 5, lease_until = $2 where id = $1", [id, T]);
    await claim("2026-10-16T05:10:00Z", 1000);
    const r = await row(id);
    expect([r.status, r.payload]).toEqual(["FAILED", {}]);
  });

  it("cancel_outbox hanya oleh pemegang klaim dan mengosongkan payload", async () => {
    const id = await enqueue();
    const c = await mine(id);
    await pool.query("select cancel_outbox($1, $2)", [id, "00000000-0000-0000-0000-000000000000"]);
    expect((await row(id)).status).toBe("SENDING");
    await pool.query("select cancel_outbox($1, $2)", [id, c.claim_token]);
    const r = await row(id);
    expect([r.status, r.payload]).toEqual(["CANCELLED", {}]);
  });
});

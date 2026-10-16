import { afterAll, describe, expect, it } from "vitest";
import { asUser, createUser, getPool } from "./helpers";

const pool = getPool();
afterAll(() => pool.end());

const T = "2026-10-16T05:00:00Z"; // 12.00 WIB, 2026-10-16
type Row = { status: string; group_id: string | null; reset_at: Date };

async function reserve(user: string, kind: string, key: string, now = T): Promise<Row> {
  return (await pool.query("select * from reserve_usage($1, $2, $3, $4)", [user, kind, key, now])).rows[0];
}
const finalize = (g: string, now = T) => pool.query("select finalize_usage($1, $2)", [g, now]);
const release = (g: string) => pool.query("select release_usage($1)", [g]);

async function use(user: string, kind: string, n: number, now = T) {
  for (let i = 0; i < n; i++) {
    const r = await reserve(user, kind, `${kind}-${i}-${Math.random()}`, now);
    expect(r.status).toBe("RESERVED");
    await finalize(r.group_id!);
  }
}

async function seedFinalized(user: string, type: "MESSAGE" | "DOCUMENT" | "REVIEW", n: number, date: string) {
  await pool.query(
    `insert into ai_usage_reservations (group_id, user_id, local_date, quota_type, idempotency_key, status, expires_at)
     select gen_random_uuid(), $1, $2::date, $3, 'seed-' || g, 'FINALIZED', now() from generate_series(1, $4) g`,
    [user, date, type, n],
  );
}

const countUsed = async (user: string, type: string, date = "2026-10-16", at = T) =>
  Number((await pool.query(
    `select count(*) from ai_usage_reservations where user_id = $1 and local_date = $2 and quota_type = $3
       and (status = 'FINALIZED' or (status = 'RESERVED' and expires_at > $4))`,
    [user, date, type, at],
  )).rows[0].count);

const makeMember = (user: string, start = "2026-10-01T00:00:00Z", end = "2026-11-01T00:00:00Z") =>
  pool.query("insert into memberships(user_id, status, period_start, period_end) values ($1, 'ACTIVE', $2, $3)", [user, start, end]);

describe("batas harian", () => {
  it("Free: pesan 20 berhasil, ke-21 ditolak dengan reset_at 00.00 WIB berikutnya", async () => {
    const u = await createUser(pool);
    await use(u, "MESSAGE", 20);
    const over = await reserve(u, "MESSAGE", "over");
    expect(over.status).toBe("QUOTA_MESSAGE");
    expect(over.reset_at.toISOString()).toBe("2026-10-16T17:00:00.000Z");
  });

  it("Free: dokumen ke-1 berhasil, ke-2 ditolak", async () => {
    const u = await createUser(pool);
    await use(u, "DOCUMENT", 1);
    expect((await reserve(u, "DOCUMENT", "d2")).status).toBe("QUOTA_DOCUMENT");
  });

  it("Member aktif: pesan 60 berhasil, ke-61 ditolak; dokumen 5 berhasil, ke-6 ditolak", async () => {
    const u = await createUser(pool);
    await makeMember(u);
    await use(u, "MESSAGE", 60);
    expect((await reserve(u, "MESSAGE", "m61")).status).toBe("QUOTA_MESSAGE");
    await use(u, "DOCUMENT", 5);
    expect((await reserve(u, "DOCUMENT", "d6")).status).toBe("QUOTA_DOCUMENT");
  });
});

describe("batas hari WIB", () => {
  it("16:59:59Z masuk 16 Okt, 17:00:00Z masuk 17 Okt dan kuota hari baru kosong", async () => {
    const u = await createUser(pool);
    await seedFinalized(u, "MESSAGE", 20, "2026-10-16");
    const lastSecond = await reserve(u, "DOCUMENT", "edge-a", "2026-10-16T16:59:59Z");
    expect(lastSecond.reset_at.toISOString()).toBe("2026-10-16T17:00:00.000Z");
    const firstSecond = await reserve(u, "MESSAGE", "edge-b", "2026-10-16T17:00:00Z");
    expect(firstSecond.status).toBe("RESERVED");
    const dates = (await pool.query("select local_date::text as d from ai_usage_reservations where user_id = $1 and idempotency_key in ('edge-a','edge-b') order by idempotency_key", [u])).rows.map((r) => r.d);
    expect(dates).toEqual(["2026-10-16", "2026-10-17"]);
    expect(firstSecond.reset_at.toISOString()).toBe("2026-10-17T17:00:00.000Z");
  });
});

describe("konkurensi dan idempotensi", () => {
  it("dua permintaan bersamaan saat sisa 1: tepat satu berhasil", async () => {
    const u = await createUser(pool);
    await seedFinalized(u, "MESSAGE", 19, "2026-10-16");
    const [a, b] = await Promise.all([reserve(u, "MESSAGE", "race-a"), reserve(u, "MESSAGE", "race-b")]);
    expect([a.status, b.status].sort()).toEqual(["QUOTA_MESSAGE", "RESERVED"]);
  });

  it("release mengembalikan kuota; reservasi lewat TTL tidak dihitung", async () => {
    const u = await createUser(pool);
    await seedFinalized(u, "MESSAGE", 19, "2026-10-16");
    const held = await reserve(u, "MESSAGE", "held");
    expect((await reserve(u, "MESSAGE", "blocked")).status).toBe("QUOTA_MESSAGE");
    await release(held.group_id!);
    const after = await reserve(u, "MESSAGE", "after-release");
    expect(after.status).toBe("RESERVED");
    // tanpa finalize: lewat 300 detik, kuota kembali tersedia
    expect((await reserve(u, "MESSAGE", "after-ttl", "2026-10-16T05:05:01Z")).status).toBe("RESERVED");
  });

  it("kunci idempoten sama → DUPLICATE dengan group sama dan tanpa tambahan hitungan", async () => {
    const u = await createUser(pool);
    const first = await reserve(u, "MESSAGE", "same");
    const second = await reserve(u, "MESSAGE", "same");
    expect(second.status).toBe("DUPLICATE");
    expect(second.group_id).toBe(first.group_id);
    expect(await countUsed(u, "MESSAGE")).toBe(1);
  });

  it("kunci yang sudah dilepas dapat dipakai ulang untuk percobaan ulang", async () => {
    const u = await createUser(pool);
    const first = await reserve(u, "MESSAGE", "retry");
    await release(first.group_id!);
    const again = await reserve(u, "MESSAGE", "retry");
    expect(again.status).toBe("RESERVED");
    expect(again.group_id).not.toBe(first.group_id);
    expect(await countUsed(u, "MESSAGE")).toBe(1);
  });

  it("finalize setelah release ditolak", async () => {
    const u = await createUser(pool);
    const r = await reserve(u, "MESSAGE", "x");
    await release(r.group_id!);
    await expect(finalize(r.group_id!)).rejects.toThrow(/RESERVATION_NOT_ACTIVE/);
  });
});

describe("AI review memakai dua kuota sekaligus", () => {
  it("Free: review ke-2 berhasil, ke-3 ditolak; tiap review memakai 1 pesan", async () => {
    const u = await createUser(pool);
    await use(u, "AI_REVIEW", 2);
    expect(await countUsed(u, "MESSAGE")).toBe(2);
    expect(await countUsed(u, "REVIEW")).toBe(2);
    expect((await reserve(u, "AI_REVIEW", "r3")).status).toBe("QUOTA_AI_REVIEW");
  });

  it("pesan habis tetapi review tersisa: ditolak tanpa reservasi review tertahan", async () => {
    const u = await createUser(pool);
    await seedFinalized(u, "MESSAGE", 20, "2026-10-16");
    expect((await reserve(u, "AI_REVIEW", "blocked")).status).toBe("QUOTA_MESSAGE");
    expect(await countUsed(u, "REVIEW")).toBe(0);
  });

  it("gagal (release) mengembalikan review dan pesan", async () => {
    const u = await createUser(pool);
    const r = await reserve(u, "AI_REVIEW", "fail");
    expect(await countUsed(u, "REVIEW")).toBe(1);
    expect(await countUsed(u, "MESSAGE")).toBe(1);
    await release(r.group_id!);
    expect(await countUsed(u, "REVIEW")).toBe(0);
    expect(await countUsed(u, "MESSAGE")).toBe(0);
  });
});

describe("perubahan plan di tengah hari", () => {
  it("upgrade: pemakaian tetap, batas naik setelah membership aktif", async () => {
    const u = await createUser(pool);
    await seedFinalized(u, "MESSAGE", 20, "2026-10-16");
    expect((await reserve(u, "MESSAGE", "before")).status).toBe("QUOTA_MESSAGE");
    await makeMember(u, "2026-10-16T06:00:00Z", "2026-11-16T06:00:00Z");
    expect((await reserve(u, "MESSAGE", "after", "2026-10-16T07:00:00Z")).status).toBe("RESERVED");
    expect(await countUsed(u, "MESSAGE")).toBe(20 + 1);
  });

  it("kedaluwarsa: terpakai 30 melebihi batas Free → sisa 0, reservasi baru ditolak", async () => {
    const u = await createUser(pool);
    await makeMember(u, "2026-10-01T00:00:00Z", "2026-10-16T06:00:00Z");
    await seedFinalized(u, "MESSAGE", 30, "2026-10-16");
    expect((await reserve(u, "MESSAGE", "late", "2026-10-16T07:00:00Z")).status).toBe("QUOTA_MESSAGE");
  });
});

describe("kedaluwarsa reservasi", () => {
  it("finalize terlambat setelah TTL ditolak dan tidak melampaui batas", async () => {
    const u = await createUser(pool);
    await seedFinalized(u, "MESSAGE", 19, "2026-10-16");
    const a = await reserve(u, "MESSAGE", "slow-a"); // kedaluwarsa 05:05:00Z
    const later = "2026-10-16T05:06:00Z";
    const b = await reserve(u, "MESSAGE", "fast-b", later);
    expect(b.status).toBe("RESERVED");
    await finalize(b.group_id!, later);
    await expect(finalize(a.group_id!, later)).rejects.toThrow(/RESERVATION_EXPIRED/);
    expect(await countUsed(u, "MESSAGE", "2026-10-16", later)).toBe(20);
  });
});

describe("akses klien ditutup", () => {
  it("authenticated tidak dapat memanggil fungsi kuota atau menulis ledger", async () => {
    const u = await createUser(pool);
    for (const sql of [
      "select * from reserve_usage(auth.uid(), 'MESSAGE', 'k', now())",
      "select finalize_usage(gen_random_uuid())",
      "select release_usage(gen_random_uuid())",
      "insert into ai_usage_reservations(group_id, user_id, local_date, quota_type, idempotency_key, expires_at) values (gen_random_uuid(), auth.uid(), current_date, 'MESSAGE', 'x', now())",
      "select * from ai_usage_reservations",
    ]) {
      await expect(asUser(pool, u, (c) => c.query(sql))).rejects.toMatchObject({ code: "42501" });
    }
  });
});

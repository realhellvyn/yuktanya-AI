import { afterAll, describe, expect, it } from "vitest";
import { asUser, createUser, getPool } from "./helpers";

const pool = getPool();
afterAll(() => pool.end());
const HASH = "b".repeat(64);
const approved = async (id: string, v: number, hash: string) =>
  (await pool.query("select is_template_approved($1, $2, $3) as ok", [id, v, hash])).rows[0].ok as boolean;

describe("persetujuan template", () => {
  it("hanya APPROVED dengan hash sama yang lolos", async () => {
    await pool.query("insert into document_templates(template_id, version, content_hash, approval_status) values ('t-draft', 1, $1, 'DRAFT'), ('t-ok', 1, $1, 'APPROVED'), ('t-old', 1, $1, 'RETIRED')", [HASH]);
    expect(await approved("t-draft", 1, HASH)).toBe(false);
    expect(await approved("t-old", 1, HASH)).toBe(false);
    expect(await approved("t-missing", 1, HASH)).toBe(false);
    expect(await approved("t-ok", 1, "c".repeat(64))).toBe(false);
    expect(await approved("t-ok", 2, HASH)).toBe(false);
    expect(await approved("t-ok", 1, HASH)).toBe(true);
  });

  it("authenticated tidak dapat menulis atau memanggil", async () => {
    const u = await createUser(pool);
    for (const sql of [
      "insert into document_templates(template_id, version, content_hash, approval_status) values ('x', 1, repeat('a', 64), 'APPROVED')",
      "select * from document_templates",
      "select is_template_approved('t-ok', 1, repeat('b', 64))",
    ]) {
      await expect(asUser(pool, u, (c) => c.query(sql))).rejects.toMatchObject({ code: "42501" });
    }
  });
});

import { describe, expect, it } from "vitest";
import { poolConfig } from "@/lib/db";

describe("pool Postgres bersama (Fix round 1, M5)", () => {
  it("menunggu koneksi paling lama 5 detik (tidak menggantung tanpa batas); ukuran pool tetap 5", () => {
    expect(poolConfig("postgres://x")).toEqual({ connectionString: "postgres://x", max: 5, connectionTimeoutMillis: 5_000 });
  });
});

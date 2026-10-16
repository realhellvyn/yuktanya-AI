import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("halaman checkout", () => {
  it("setiap jenis order punya judul (Deep Review tidak boleh kosong)", () => {
    const src = readFileSync("src/app/(app)/checkout/[orderId]/page.tsx", "utf8");
    for (const kind of ["MEMBERSHIP_MONTHLY", "MEMBERSHIP_ANNUAL", "BUNDLE", "STANDARD_REVIEW", "DEEP_REVIEW"]) expect(src).toMatch(new RegExp(`${kind}:\\s*"`));
  });
});

describe("halaman admin", () => {
  it("halaman pencabutan verifikasi memeriksa peran platform_admin di tingkat halaman", () => {
    const src = readFileSync("src/app/(admin)/admin/verifications/page.tsx", "utf8");
    expect(src).toMatch(/platform_admin/);
  });
});

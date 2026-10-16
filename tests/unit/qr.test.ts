import { describe, expect, it } from "vitest";
import { qrPng, verifyUrl } from "@/lib/verification/qr";

const CODE = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4";
describe("QR verifikasi", () => {
  it("URL kanonik memuat kode dan tidak memuat data pribadi", () => {
    expect(verifyUrl(CODE, "https://yuktanya.example/")).toBe(`https://yuktanya.example/verify/${CODE}`);
    expect(verifyUrl(CODE)).not.toMatch(/@|\?|#/);
  });
  it("menolak kode yang bukan opaque", () => {
    for (const bad of ["pendek", "a b".repeat(20), "../".repeat(20), `${CODE}?email=x@y.z`]) expect(() => verifyUrl(bad)).toThrow();
  });
  it("menghasilkan PNG valid", async () => {
    const png = await qrPng(verifyUrl(CODE, "https://yuktanya.example"));
    expect(Array.from(png.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.byteLength).toBeGreaterThan(200);
  });
});

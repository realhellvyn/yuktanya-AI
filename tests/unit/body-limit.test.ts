import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ACTION_BODY_LIMIT_BYTES, oversizedActionBody } from "@/lib/security/body-limit";

describe("batas badan server action (Task 24, A24 M1)", () => {
  const MB = 1024 * 1024;
  it("POST > 1 MB ke halaman selain unggahan ditolak; halaman unggahan boleh sampai batas global 6 MB", () => {
    expect(ACTION_BODY_LIMIT_BYTES).toBe(MB);
    expect(oversizedActionBody("POST", "/workspace/abc", String(MB + 1))).toBe(true);
    expect(oversizedActionBody("POST", "/settings", String(5 * MB))).toBe(true);
    expect(oversizedActionBody("POST", "/workspace/abc", String(MB))).toBe(false);
    expect(oversizedActionBody("POST", "/documents/upload", String(5 * MB + 20_000))).toBe(false);
    expect(oversizedActionBody("POST", "/documents/upload/", String(5 * MB))).toBe(false);
  });
  it("GET, rute API, dan permintaan tanpa Content-Length yang sah tidak diperiksa di sini", () => {
    expect(oversizedActionBody("GET", "/workspace/abc", String(5 * MB))).toBe(false);
    expect(oversizedActionBody("POST", "/api/payments/webhook/midtrans", String(5 * MB))).toBe(false);
    expect(oversizedActionBody("POST", "/workspace/abc", null)).toBe(false);
    expect(oversizedActionBody("POST", "/workspace/abc", "abc")).toBe(false);
  });
  it("proxy memakai pemeriksaan ini sebelum hal lain; batas global Next tetap 6 MB untuk unggahan", () => {
    expect(readFileSync("src/proxy.ts", "utf8")).toMatch(/oversizedActionBody\(request\.method, pathname, request\.headers\.get\("content-length"\)\)/);
    expect(readFileSync("next.config.ts", "utf8")).toContain('bodySizeLimit: "6mb"');
  });
});

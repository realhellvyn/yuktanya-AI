import { describe, expect, it } from "vitest";
import { isRecoverySession } from "@/lib/auth/recovery";

const NOW = new Date("2026-10-16T10:00:00Z");
const sec = Math.floor(NOW.getTime() / 1000);
const jwt = (payload: object) => `h.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.s`;

describe("isRecoverySession", () => {
  it("menerima sesi dari tautan pemulihan yang masih baru", () => {
    expect(isRecoverySession(jwt({ amr: [{ method: "recovery", timestamp: sec - 60 }] }), NOW)).toBe(true);
    expect(isRecoverySession(jwt({ amr: [{ method: "otp", timestamp: sec - 60 }] }), NOW)).toBe(true);
  });
  it("menolak sesi masuk biasa (kata sandi, Google) dan token tanpa penanda", () => {
    expect(isRecoverySession(jwt({ amr: [{ method: "password", timestamp: sec - 60 }] }), NOW)).toBe(false);
    expect(isRecoverySession(jwt({ amr: [{ method: "oauth", timestamp: sec - 60 }] }), NOW)).toBe(false);
    expect(isRecoverySession(jwt({ sub: "x" }), NOW)).toBe(false);
  });
  it("menolak pemulihan yang sudah lewat 1 jam, token rusak, atau kosong", () => {
    expect(isRecoverySession(jwt({ amr: [{ method: "recovery", timestamp: sec - 3601 }] }), NOW)).toBe(false);
    expect(isRecoverySession("bukan-jwt", NOW)).toBe(false);
    expect(isRecoverySession(undefined, NOW)).toBe(false);
  });
});

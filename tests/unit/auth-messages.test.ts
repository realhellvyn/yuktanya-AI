import { describe, expect, it } from "vitest";
import { AUTH_MESSAGES, authErrorCode, normalizeEmail } from "@/lib/auth/messages";

describe("authErrorCode", () => {
  it("memetakan batas kirim email ke kode rate_limited", () => {
    expect(authErrorCode({ code: "over_email_send_rate_limit", status: 429 })).toBe("rate_limited");
    expect(authErrorCode({ status: 429, message: "x" })).toBe("rate_limited");
  });
  it("memetakan kata sandi lemah, sama dengan yang lama, dan sesi hilang", () => {
    expect(authErrorCode({ code: "weak_password" })).toBe("weak_password");
    expect(authErrorCode({ code: "same_password" })).toBe("same_password");
    expect(authErrorCode({ code: "session_not_found" })).toBe("session_missing");
    expect(authErrorCode({ message: "Auth session missing!" })).toBe("session_missing");
  });
  it("kesalahan lain menjadi failed", () => {
    expect(authErrorCode({ code: "unexpected_failure", status: 500 })).toBe("failed");
    expect(authErrorCode(null)).toBe("failed");
  });
});

describe("AUTH_MESSAGES", () => {
  it("setiap kode punya pesan Indonesia yang sederhana tanpa istilah teknis", () => {
    for (const code of ["invalid", "failed", "unconfigured", "rate_limited", "weak_password", "same_password", "session_missing", "mismatch"]) {
      const text = AUTH_MESSAGES[code];
      expect(text, code).toBeTruthy();
      expect(text).not.toMatch(/rate limit|jwt|token|exception|error/i);
    }
  });
});

describe("normalizeEmail", () => {
  it("memangkas spasi dan menolak email tidak valid", () => {
    expect(normalizeEmail("  a@b.co ")).toBe("a@b.co");
    expect(normalizeEmail("bukan-email")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
  });
});

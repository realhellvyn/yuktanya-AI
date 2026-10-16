import { describe, expect, it } from "vitest";
import { googleAuthEnabled, googleRedirectTo } from "@/lib/auth/google";

describe("googleAuthEnabled", () => {
  it("hanya aktif bila NEXT_PUBLIC_GOOGLE_AUTH persis 'true'", () => {
    expect(googleAuthEnabled({ NEXT_PUBLIC_GOOGLE_AUTH: "true" })).toBe(true);
    expect(googleAuthEnabled({ NEXT_PUBLIC_GOOGLE_AUTH: "TRUE" })).toBe(false);
    expect(googleAuthEnabled({ NEXT_PUBLIC_GOOGLE_AUTH: "1" })).toBe(false);
    expect(googleAuthEnabled({})).toBe(false);
  });
});

describe("googleRedirectTo", () => {
  it("mengarah ke callback dengan tujuan yang di-encode", () => {
    expect(googleRedirectTo("https://yuktanya-ai.vercel.app", "/workspace/new?x=1")).toBe(
      "https://yuktanya-ai.vercel.app/auth/callback?next=%2Fworkspace%2Fnew%3Fx%3D1",
    );
  });
});

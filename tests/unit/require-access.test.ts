import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

import { requireAccess } from "@/lib/auth/require-access";

describe("requireAccess (pertahanan berlapis di layout)", () => {
  it("tanpa sesi → login dengan returnTo", async () => {
    await expect(requireAccess("/admin", async () => null)).rejects.toThrow("REDIRECT:/login?returnTo=%2Fadmin");
  });

  it("user biasa ke /admin → /dashboard", async () => {
    await expect(requireAccess("/admin", async () => ({ userId: "u", roles: ["user"] }))).rejects.toThrow("REDIRECT:/dashboard");
  });

  it("platform_admin ke /admin lolos; reviewer ke /partner lolos", async () => {
    await expect(requireAccess("/admin", async () => ({ userId: "u", roles: ["user", "platform_admin"] }))).resolves.toBeUndefined();
    await expect(requireAccess("/partner", async () => ({ userId: "u", roles: ["user", "reviewer"] }))).resolves.toBeUndefined();
  });
});

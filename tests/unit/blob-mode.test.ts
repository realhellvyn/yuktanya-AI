import { describe, expect, it } from "vitest";
import { chooseBlobMode } from "@/lib/documents/blob";

describe("chooseBlobMode", () => {
  it("produksi tanpa konfigurasi Supabase gagal keras (tidak diam-diam ke disk lokal)", () => {
    expect(() => chooseBlobMode({ NODE_ENV: "production" })).toThrow(/Supabase/);
    expect(() => chooseBlobMode({ NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co" })).toThrow(/Supabase/);
  });

  it("produksi dengan konfigurasi lengkap memakai Supabase; selain produksi memakai berkas lokal", () => {
    expect(chooseBlobMode({ NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k" })).toBe("supabase");
    expect(chooseBlobMode({ NODE_ENV: "development" })).toBe("fs");
    expect(chooseBlobMode({})).toBe("fs");
  });
});

import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createFsBlobStore } from "@/lib/documents/blob";

const root = () => mkdtempSync(path.join(tmpdir(), "blob-"));
const bytes = (s: string) => new TextEncoder().encode(s);

describe("FsBlobStore", () => {
  it("put/get roundtrip dan path tak ada → null", async () => {
    const s = createFsBlobStore(root());
    await s.put("u1/d1/a.pdf", bytes("halo"));
    expect(new TextDecoder().decode((await s.get("u1/d1/a.pdf"))!)).toBe("halo");
    expect(await s.get("u1/d1/tidak-ada.pdf")).toBeNull();
  });

  it("delete menghapus berkas dan tidak melempar bila sudah tidak ada", async () => {
    const s = createFsBlobStore(root());
    await s.put("u1/d1/a.pdf", bytes("halo"));
    await s.delete("u1/d1/a.pdf");
    expect(await s.get("u1/d1/a.pdf")).toBeNull();
    await expect(s.delete("u1/d1/a.pdf")).resolves.toBeUndefined();
    await expect(s.delete("../x")).rejects.toThrow(/path/i);
  });

  it.each(["../x", "/abs/x", "a/../b", "a\\b", "a\0b", "", "a//b", "..", "./x"])("menolak path tidak aman %j", async (p) => {
    const s = createFsBlobStore(root());
    await expect(s.put(p, bytes("x"))).rejects.toThrow(/path/i);
    await expect(s.get(p)).rejects.toThrow(/path/i);
  });

  it("tidak dapat menulis di luar rootDir", async () => {
    const r = root();
    const s = createFsBlobStore(r);
    await expect(s.put("../luar.txt", bytes("x"))).rejects.toThrow();
    expect(existsSync(path.join(r, "..", "luar.txt"))).toBe(false);
  });
});

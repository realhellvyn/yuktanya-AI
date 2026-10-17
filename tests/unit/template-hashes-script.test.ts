import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TEMPLATES } from "@/lib/documents/templates/registry";

// scripts/templates/print-hashes.mjs dipakai saat mencatat ulang persetujuan template (docs/RELEASE_CHECKLIST.md).
describe("scripts/templates/print-hashes.mjs", () => {
  it("mencetak id, versi, dan content hash ketiga template untuk commit saat ini", () => {
    const root = join(__dirname, "..", "..");
    const out = execFileSync(process.execPath, [join(root, "scripts", "templates", "print-hashes.mjs")], { cwd: root, encoding: "utf8" });
    const lines = out.trim().split("\n");
    expect(lines).toHaveLength(3);
    for (const category of ["NDA", "PKS", "UTANG_PIUTANG"] as const) {
      const t = TEMPLATES[category];
      expect(lines).toContain(`${category}\t${t.id}\t${t.version}\t${t.contentHash()}`);
    }
    for (const l of lines) expect(l).toMatch(/^[A-Z_]+\t[a-z-]+\t\d+\t[0-9a-f]{64}$/);
  }, 30000);

  it("jiti yang dipakai skrip adalah devDependency langsung yang dipin, sama dengan lockfile", () => {
    const root = join(__dirname, "..", "..");
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
    expect(pkg.devDependencies.jiti).toBe("2.7.0");
    expect(lock.packages[""].devDependencies.jiti).toBe("2.7.0");
    expect(lock.packages["node_modules/jiti"].version).toBe("2.7.0");
  });
});

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { guardPath } from "@/lib/auth/permissions";

// Setiap job terjadwal di vercel.json harus punya rute dengan GET (Vercel Cron) dan POST, dan penyapuan order kedaluwarsa terjadwal harian.
describe("jadwal job (vercel.json)", () => {
  const crons = (JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: { path: string; schedule: string }[] }).crons;
  it("penyapuan order kedaluwarsa terjadwal sekali sehari", () => {
    const c = crons.find((x) => x.path === "/api/jobs/expire-orders");
    expect(c).toBeDefined();
    expect(c!.schedule).toMatch(/^\d{1,2} \d{1,2} \* \* \*$/);
  });
  it("setiap jalur cron punya rute GET dan POST yang memakai rahasia CRON_SECRET", () => {
    for (const c of crons) {
      const f = `src/app${c.path}/route.ts`;
      expect(existsSync(f), f).toBe(true);
      const src = readFileSync(f, "utf8");
      expect(src).toMatch(/export const GET = run/);
      expect(src).toMatch(/export const POST = run/);
      expect(src).toContain("process.env.CRON_SECRET");
      // Penjadwal tidak membawa sesi: proxy meloloskan, rute sendiri yang memeriksa rahasia.
      expect(guardPath(c.path, null).allow).toBe(true);
    }
  });
});

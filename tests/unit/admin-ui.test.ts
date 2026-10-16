import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { KpiCard } from "@/components/admin/kpi-card";
import { RangeNav } from "@/components/admin/range-nav";
import { fmtCount, fmtHours, fmtIdr, fmtMs, fmtPercent, NO_DATA, parseRange } from "@/lib/admin/format";

describe("parseRange", () => {
  const now = new Date("2026-10-16T18:30:00Z"); // 17 Oktober 01.30 WIB
  it("default 7 hari penuh WIB, akhir eksklusif tengah malam WIB berikutnya", () => {
    const r = parseRange({}, now);
    expect(r.days).toBe(7);
    expect(r.to.toISOString()).toBe("2026-10-17T17:00:00.000Z");
    expect(r.from.toISOString()).toBe("2026-10-10T17:00:00.000Z");
  });
  it("hari ini dan 30 hari; nilai ngawur kembali ke 7 hari", () => {
    expect(parseRange({ r: "1" }, now).from.toISOString()).toBe("2026-10-16T17:00:00.000Z");
    expect(parseRange({ r: "30" }, now).days).toBe(30);
    for (const bad of ["99", "abc", "", "-1", "7; drop"]) expect(parseRange({ r: bad }, now).days).toBe(7);
  });
  it("batas hari mengikuti WIB, bukan UTC", () => {
    const justBeforeMidnightWib = new Date("2026-10-16T16:59:00Z");
    expect(parseRange({ r: "1" }, justBeforeMidnightWib).to.toISOString()).toBe("2026-10-16T17:00:00.000Z");
  });
});

describe("format", () => {
  it("null selalu 'Belum ada data' dan nol tetap nol", () => {
    for (const f of [fmtCount, fmtIdr, fmtPercent, fmtMs, fmtHours]) {
      expect(f(null)).toBe(NO_DATA);
      expect(f(undefined)).toBe(NO_DATA);
    }
    expect(fmtCount(0)).toBe("0");
    expect(fmtIdr(0)).toBe("Rp0");
    expect(fmtIdr(150000)).toBe("Rp150.000");
    expect(fmtPercent(0.8333)).toBe("83,3%");
  });
});

describe("komponen admin", () => {
  it("KpiCard menampilkan nilai dan petunjuk", () => {
    const h = renderToStaticMarkup(KpiCard({ label: "Pendapatan dikumpulkan", value: NO_DATA, hint: "Dari pembayaran terverifikasi" }));
    expect(h).toContain("Belum ada data");
    expect(h).toContain("dikumpulkan");
    expect(h).not.toMatch(/laba|MRR|\bcap\b/i);
  });
  it("RangeNav menandai pilihan dengan teks dan tautan min-h-12", () => {
    const h = renderToStaticMarkup(RangeNav({ path: "/admin", range: parseRange({ r: "30" }) }));
    expect(h).toContain("30 hari (dipilih)");
    expect(h).toContain("WIB");
    for (const tag of h.match(/<a [^>]*>/g) ?? []) expect(tag).toContain("min-h-12");
  });
});

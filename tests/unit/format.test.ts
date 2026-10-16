import { describe, expect, it } from "vitest";
import { FormatError, formatDateId, parseDateId, parseIdr } from "@/lib/documents/format";

describe("parseIdr", () => {
  it.each(["Rp5.000.000", "5.000.000", "5000000", " Rp 5.000.000 ", "rp5.000.000"])("menerima %j", (raw) => {
    expect(parseIdr(raw)).toBe(5_000_000);
  });

  it("menerima nol (validasi positif ada di skema)", () => {
    expect(parseIdr("0")).toBe(0);
    expect(parseIdr("Rp 0")).toBe(0);
  });

  it.each(["1,5", "-1", "abc", "", "5.000.000,00", "9007199254740993", "1.5", "Rp", "5.00.000"])("menolak %j", (raw) => {
    expect(() => parseIdr(raw)).toThrow(FormatError);
  });
});

describe("parseDateId", () => {
  it.each(["16 Oktober 2026", "16/10/2026", "2026-10-16", "16 oktober 2026", "6/10/2026"])("menerima %j", (raw) => {
    expect(parseDateId(raw)).toMatch(/^2026-10-(16|06)$/);
  });

  it.each(["31 Februari 2026", "2026-13-01", "", "29 Februari 2026", "32/01/2026", "16 Oktobar 2026"])("menolak %j", (raw) => {
    expect(() => parseDateId(raw)).toThrow(FormatError);
  });

  it("menerima 29 Februari pada tahun kabisat", () => {
    expect(parseDateId("29 Februari 2028")).toBe("2028-02-29");
  });

  it("formatDateId menulis nama bulan Indonesia tanpa nol di depan", () => {
    expect(formatDateId("2026-10-16")).toBe("16 Oktober 2026");
    expect(formatDateId("2026-01-05")).toBe("5 Januari 2026");
  });
});

describe("addMonthsIso", () => {
  it("menambah bulan, memotong hari ke akhir bulan, dan melewati pergantian tahun", async () => {
    const { addMonthsIso } = await import("@/lib/documents/format");
    expect(addMonthsIso("2026-10-16", 24)).toBe("2028-10-16");
    expect(addMonthsIso("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsIso("2027-01-31", 1)).toBe("2027-02-28");
    expect(addMonthsIso("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonthsIso("2026-11-30", 3)).toBe("2027-02-28");
    expect(addMonthsIso("2026-12-15", 1)).toBe("2027-01-15");
  });
});

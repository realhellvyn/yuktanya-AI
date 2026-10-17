import { describe, expect, it } from "vitest";
import { guardPath } from "@/lib/auth/permissions";
import { SPECIAL_CASE_NOTE } from "@/lib/copy";
import { CASE_ERROR_CODES } from "@/lib/cases/service";
import { CASE_ERROR_TEXT, CASE_STATUS_LABEL, caseErrorText, caseTimeline, parseQuoteForm, quoteExpired } from "@/lib/cases/view";

describe("tampilan kasus khusus", () => {
  it("salinan wajib persis", () => {
    expect(SPECIAL_CASE_NOTE).toBe("Biaya dan ruang lingkup ditentukan setelah asesmen profesional.");
  });
  it("setiap kode kesalahan DB punya teks sederhana; tanpa kata 'cap'", () => {
    for (const c of CASE_ERROR_CODES) expect(CASE_ERROR_TEXT[c]).toBeTruthy();
    for (const t of [...Object.values(CASE_ERROR_TEXT), ...Object.values(CASE_STATUS_LABEL)]) expect(t).not.toMatch(/\bcap\b/i);
    expect(caseErrorText(undefined)).toBeNull();
    expect(caseErrorText("ANEH")).toBe("Tindakan belum berhasil. Muat ulang halaman, lalu coba lagi.");
  });
  it("kode dari alamat (?e=) tidak pernah membaca properti bawaan objek (halaman /cases/[id], /partner/cases/[id], /admin/cases)", () => {
    for (const hostile of ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"]) {
      expect(caseErrorText(hostile)).toBe("Tindakan belum berhasil. Muat ulang halaman, lalu coba lagi.");
    }
    expect(caseErrorText("NOT_FOUND")).toBe("Kasus atau dokumen tidak ditemukan. Muat ulang halaman, lalu coba lagi.");
    expect(caseErrorText("SPECIAL_CASE_OPEN")).toBe(CASE_ERROR_TEXT.SPECIAL_CASE_OPEN);
    expect(caseErrorText("")).toBeNull();
    expect(typeof caseErrorText("__proto__")).toBe("string");
  });
  it("tahapan mengikuti status", () => {
    expect(caseTimeline("SUBMITTED").map((s) => s.state)).toEqual(["done", "current", "todo", "todo"]);
    expect(caseTimeline("QUOTED").map((s) => s.state)).toEqual(["done", "done", "done", "current"]);
    expect(caseTimeline("ACCEPTED").every((s) => s.state === "done")).toBe(true);
  });
  it("formulir penawaran: titik ribuan, batas nominal, ruang lingkup, tanggal akhir hari WIB", () => {
    const ok = parseQuoteForm({ amount: "Rp 2.500.000", scope: "Telaah kontrak distribusi", expiresOn: "2026-10-20" });
    expect(ok).toEqual({ ok: true, value: { amountIdr: 2_500_000, scope: "Telaah kontrak distribusi", expiresAt: new Date("2026-10-20T16:59:59Z") } });
    expect(parseQuoteForm({ amount: "abc", scope: "Telaah kontrak", expiresOn: "2026-10-20" })).toEqual({ ok: false, code: "INVALID_AMOUNT" });
    expect(parseQuoteForm({ amount: "500", scope: "Telaah kontrak", expiresOn: "2026-10-20" })).toEqual({ ok: false, code: "INVALID_AMOUNT" });
    expect(parseQuoteForm({ amount: "1000", scope: "pendek", expiresOn: "2026-10-20" })).toEqual({ ok: false, code: "INVALID_SCOPE" });
    expect(parseQuoteForm({ amount: "1000", scope: "Telaah kontrak", expiresOn: "20-10-2026" })).toEqual({ ok: false, code: "INVALID_EXPIRY" });
  });
  it("kedaluwarsa dihitung terhadap waktu sekarang", () => {
    expect(quoteExpired("2026-10-16T05:00:00Z", new Date("2026-10-16T05:00:00Z"))).toBe(true);
    expect(quoteExpired("2026-10-16T05:00:01Z", new Date("2026-10-16T05:00:00Z"))).toBe(false);
    expect(quoteExpired(null)).toBe(false);
  });
});

describe("guard rute kasus khusus", () => {
  it("/cases hanya untuk akun pemilik; /partner/cases hanya koordinator", () => {
    expect(guardPath("/cases/new", ["user"])).toEqual({ allow: true });
    expect(guardPath("/cases/x", null)).toEqual({ allow: false, redirect: "/login?returnTo=%2Fcases%2Fx" });
    expect(guardPath("/cases", ["user", "reviewer"])).toEqual({ allow: false, redirect: "/partner" });
    expect(guardPath("/cases", ["user", "platform_admin"])).toEqual({ allow: false, redirect: "/admin" });
    expect(guardPath("/partner/cases", ["user", "partner_admin"])).toEqual({ allow: true });
    expect(guardPath("/partner/cases/abc", ["user", "reviewer"])).toEqual({ allow: false, redirect: "/partner" });
    expect(guardPath("/partner/cases", ["user"])).toEqual({ allow: false, redirect: "/dashboard" });
    expect(guardPath("/admin/cases", ["user", "partner_admin"])).toEqual({ allow: false, redirect: "/partner" });
    expect(guardPath("/admin/cases", ["user", "platform_admin"])).toEqual({ allow: true });
  });
});

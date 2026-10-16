import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PublicVerification } from "@/components/verification/public-verification";
import { VerificationPanel } from "@/components/verification/verification-panel";
import { LEGAL_DISCLAIMER, NEW_VERSION_NOT_REVIEWED } from "@/lib/copy";
import type { PublicVerificationResult, VerificationView } from "@/lib/verification/service";

const CODE = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4";
const SHA = "e".repeat(64);
const active = (over: Partial<Extract<PublicVerificationResult, { kind: unknown }>> = {}): PublicVerificationResult => ({
  status: "ACTIVE", kind: "LEGAL", issuedAt: "2026-10-16T18:00:00.000Z", sha256: SHA, scopeSummary: null, outcome: "WITH_NOTES", ...over,
} as PublicVerificationResult);
const html = (r: PublicVerificationResult) => renderToStaticMarkup(PublicVerification({ result: r, code: CODE }));

describe("PublicVerification", () => {
  it("tak dikenal → pesan tetap tanpa kode atau hash", () => {
    const h = html({ status: "NOT_FOUND" });
    expect(h).toContain("Kode tidak ditemukan");
    expect(h).not.toContain(SHA);
  });

  it("dicabut → status Dicabut dengan penjelasan dan tanpa pernyataan aktif", () => {
    const h = html(active({ status: "REVOKED" } as never));
    expect(h).toContain("Dicabut");
    expect(h).not.toContain("Status: Aktif");
  });

  it("aktif → jenis, tanggal WIB, kode, hash, pernyataan wajib, penafian, QR bukan tanda tangan; tanpa isi atau nama pihak", () => {
    const h = html(active());
    for (const s of ["Yuktanya Legal Verified", "Status: Aktif", "17 Oktober 2026", CODE, SHA, "Pemeriksaan selesai dengan catatan", LEGAL_DISCLAIMER, "bukan tanda tangan"]) expect(h).toContain(s);
    expect(h).not.toMatch(/Sinta|ZZ-|Ruang lingkup/);
  });

  it("ruang lingkup hanya tampil bila diberikan proyeksi", () => {
    expect(html(active({ scopeSummary: "Klausul kerahasiaan" }))).toContain("Klausul kerahasiaan");
  });

  it("AI memakai pernyataan AI dan jenis WITHIN_SCOPE memakai pernyataan tanpa catatan", () => {
    expect(html(active({ kind: "AI", outcome: "COMPLETED" } as never))).toContain("Bukan pengesahan hukum dan belum diperiksa pengacara");
    expect(html(active({ outcome: "WITHIN_SCOPE" }))).toContain("memenuhi kriteria dalam ruang lingkup pemeriksaan");
  });

  it("tanpa kata 'cap' dan tautan min-h-12", () => {
    for (const r of [active(), active({ status: "REVOKED" } as never), { status: "NOT_FOUND" } as const]) {
      const h = html(r);
      expect(h).not.toMatch(/\bcap\b/i);
      for (const tag of h.match(/<(a|button) [^>]*>/g) ?? []) expect(tag).toContain("min-h-12");
    }
  });
});

describe("VerificationPanel", () => {
  const v: VerificationView = { id: "v1", kind: "LEGAL", status: "ACTIVE", outcome: "WITHIN_SCOPE", code: CODE, sha256: SHA, issuedAt: "2026-10-16T05:00:00.000Z", scopeSummary: null };
  it("versi tanpa verifikasi → 'Versi baru belum diperiksa'", () => {
    expect(renderToStaticMarkup(VerificationPanel({ verifications: [], qrDataUrls: {}, urls: {} }))).toContain(NEW_VERSION_NOT_REVIEWED);
  });
  it("menampilkan URL yang dapat dibaca, kode, QR, status teks, dan status dicabut eksplisit", () => {
    const h = renderToStaticMarkup(VerificationPanel({ verifications: [v, { ...v, id: "v2", status: "REVOKED" }], qrDataUrls: { v1: "data:image/png;base64,AAAA" }, urls: { v1: `https://y.example/verify/${CODE}`, v2: `https://y.example/verify/${CODE}` } }));
    for (const s of [`https://y.example/verify/${CODE}`, CODE, "Status: Aktif", "Status: Dicabut", "data:image/png;base64,AAAA", LEGAL_DISCLAIMER]) expect(h).toContain(s);
    expect(h).not.toMatch(/\bcap\b/i);
    for (const tag of h.match(/<(a|button) [^>]*>/g) ?? []) expect(tag).toContain("min-h-12");
  });
});

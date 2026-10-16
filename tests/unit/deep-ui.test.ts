import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DeepOffer } from "@/components/deep/deep-offer";
import { DeepResult } from "@/components/deep/deep-result";
import { CHECKOUT_NOTE, LEGAL_DISCLAIMER, VERIFICATION_STATEMENTS } from "@/lib/copy";
import type { OwnerDeep } from "@/lib/deep/service";

const noop = async () => {};
const offer = (over: Partial<Parameters<typeof DeepOffer>[0]> = {}) =>
  renderToStaticMarkup(DeepOffer({ eligible: true, reason: "OK", quote: { amountIdr: 200000, variant: "FREE" }, action: noop, parentRequestId: "p1", standardPaidIdr: 50000, ...over }));
const links = (h: string) => h.match(/<(a|button) [^>]*>/g) ?? [];

describe("DeepOffer", () => {
  it("Free: Rp200.000 tambahan, Member Rp150.000, standar dihitung terpisah, membership terpisah, pernyataan pembayaran, tanpa janji hasil atau 'cap'", () => {
    const h = offer();
    for (const s of ["Rp200.000", "Rp150.000", "Rp50.000", "dihitung terpisah", "Rp19.000", CHECKOUT_NOTE, "Pembayaran tidak menjamin"]) expect(h).toContain(s);
    expect(h).not.toMatch(/\bcap\b|dijamin|pasti disetujui/i);
    for (const tag of links(h)) expect(tag).toContain("min-h-12");
  });
  it("Member menampilkan Rp150.000 sebagai harga Member", () => {
    const h = offer({ quote: { amountIdr: 150000, variant: "MEMBER" } });
    expect(h).toContain("Rp150.000");
    expect(h).toContain("Harga Member aktif");
  });
  it("tidak layak menampilkan alasan yang dapat dibaca dan tanpa tombol beli", () => {
    const h = offer({ eligible: false, reason: "NO_ACTIONABLE_NOTES", quote: null });
    expect(h).toContain("tidak memiliki catatan yang perlu ditindaklanjuti");
    expect(h).not.toContain("<form");
  });
});

const deep = (over: Partial<OwnerDeep> = {}): OwnerDeep => ({
  deepId: "d", parentRequestId: "p", versionId: "v", status: "COMPLETED", outcome: "ENHANCED_APPROVED", createdAt: "2026-10-16T05:00:00.000Z", completedAt: "2026-10-17T05:00:00.000Z",
  extraWork: "Pemeriksaan identitas", summary: "Selesai", decision: "APPROVE", decisionReason: null,
  dispositions: [{ noteNo: 1, disposition: "RESOLVED", evidence: "Diperbaiki" }], verification: { code: "e".repeat(48), status: "ACTIVE" }, ...over,
});

describe("DeepResult", () => {
  it("Enhanced disetujui: hasil nyata, disposisi, pernyataan wajib Enhanced, kode, penafian", () => {
    const h = renderToStaticMarkup(DeepResult({ deep: deep(), verifyUrl: "https://y.example/verify/x" }));
    for (const s of ["Selesai — Enhanced disetujui", "Catatan 1: Sudah diselesaikan", VERIFICATION_STATEMENTS.LEGAL_ENHANCED, "e".repeat(48), LEGAL_DISCLAIMER, "Status: Aktif"]) expect(h).toContain(s);
    expect(h).not.toMatch(/\bcap\b/i);
    for (const tag of links(h)) expect(tag).toContain("min-h-12");
  });
  it("hasil negatif tidak memuat pernyataan Enhanced atau kode, dan jelas bahwa Enhanced tidak terbit", () => {
    for (const [outcome, title] of [["COMPLETED_WITH_NOTES", "tanpa Enhanced"], ["INCONCLUSIVE", "Belum dapat disimpulkan"], ["REFERRED_SPECIAL_CASE", "kasus khusus"]] as const) {
      const h = renderToStaticMarkup(DeepResult({ deep: deep({ outcome, verification: null, decisionReason: "Kriteria M3 tidak terpenuhi" }) }));
      expect(h).toContain(title);
      expect(h).toContain("tidak menghasilkan Yuktanya Legal Verified — Enhanced");
      expect(h).not.toContain(VERIFICATION_STATEMENTS.LEGAL_ENHANCED);
      expect(h).toContain("Kriteria M3 tidak terpenuhi");
    }
  });
  it("ditangguhkan dan ditahan ditampilkan eksplisit", () => {
    expect(renderToStaticMarkup(DeepResult({ deep: deep({ verification: { code: "e".repeat(48), status: "SUSPENDED" } }) }))).toContain("Ditangguhkan sementara");
    expect(renderToStaticMarkup(DeepResult({ deep: deep({ status: "ON_HOLD", outcome: null }) }))).toContain("Ditahan karena verifikasi induk dicabut");
  });
});

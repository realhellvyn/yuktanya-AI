import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DeepOffer } from "@/components/deep/deep-offer";
import { DeepResult } from "@/components/deep/deep-result";
import { CHECKOUT_NOTE, ENHANCED_RUBRIC_PENDING, LEGAL_DISCLAIMER, VERIFICATION_STATEMENTS } from "@/lib/copy";
import { EnhancedRubricNotice } from "@/components/deep/enhanced-availability";
import { readFileSync } from "node:fs";
import { offerViewProps } from "@/lib/deep/owner-pages";
import type { Eligibility, OwnerDeep } from "@/lib/deep/service";

const noop = async () => {};
// Alur data halaman: hasil deepService().eligibility (termasuk harga standar yang sudah dibayar) → offerViewProps → DeepOffer.
const eligibility = (over: Partial<Eligibility> = {}): Eligibility => ({ eligible: true, reason: "OK", quote: { amountIdr: 200000, variant: "FREE" }, standardPaidIdr: 50000, ...over });
const offer = (over: Partial<Eligibility> = {}, rubricApproved = true) =>
  renderToStaticMarkup(DeepOffer({ ...offerViewProps(eligibility(over)), rubricApproved, action: noop, parentRequestId: "p1" }));
const links = (h: string) => h.match(/<(a|button) [^>]*>/g) ?? [];

describe("DeepOffer", () => {
  it("Free: Rp200.000 tambahan, Member Rp150.000, standar dihitung terpisah, membership terpisah, pernyataan pembayaran, tanpa janji hasil atau 'cap'", () => {
    const h = offer();
    for (const s of ["Rp200.000", "Rp150.000", "Rp50.000", "dihitung terpisah", "Rp19.000", CHECKOUT_NOTE, "Pembayaran tidak menjamin"]) expect(h).toContain(s);
    expect(h).not.toMatch(/\bcap\b|dijamin|pasti disetujui/i);
    for (const tag of links(h)) expect(tag).toContain("min-h-12");
  });
  it("harga standar yang sudah dibayar dan total yang dibayar sekarang tampil dari data kelayakan", () => {
    const h = offer({ quote: { amountIdr: 150000, variant: "MEMBER" }, standardPaidIdr: 30000 });
    expect(h).toContain("Legal Review yang sudah dibayar");
    expect(h).toContain("Rp30.000 (dihitung terpisah)");
    expect(h).toMatch(/Total dibayar sekarang<\/dt><dd[^>]*>Rp150\.000/);
    expect(offer({ standardPaidIdr: 0 })).toContain("Memakai kredit Legal Review");
  });
  it("kedua halaman tawaran memakai offerViewProps (harga standar tidak dibuang)", () => {
    for (const f of ["src/app/(app)/reviews/[id]/page.tsx", "src/app/(app)/reviews/[id]/deep/page.tsx"]) {
      const src = readFileSync(f, "utf8");
      expect(src).toContain("offerViewProps(");
      expect(src).not.toMatch(/standardPaidIdr=\{undefined\}/);
    }
  });
  it("Member menampilkan Rp150.000 sebagai harga Member", () => {
    const h = offer({ quote: { amountIdr: 150000, variant: "MEMBER" } });
    expect(h).toContain("Rp150.000");
    expect(h).toContain("Harga Member aktif");
  });
  it("tidak layak menampilkan alasan yang dapat dibaca dan tanpa tombol beli", () => {
    const h = offer({ eligible: false, reason: "NO_ACTIONABLE_NOTES", quote: null, standardPaidIdr: null });
    expect(h).toContain("tidak memuat Legal Note yang perlu ditindaklanjuti");
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
    for (const s of ["Selesai: Enhanced disetujui", "Catatan 1: Sudah diselesaikan", VERIFICATION_STATEMENTS.LEGAL_ENHANCED, "e".repeat(48), LEGAL_DISCLAIMER, "Status: Aktif"]) expect(h).toContain(s);
    expect(h).not.toMatch(/\bcap\b/i);
    for (const tag of links(h)) expect(tag).toContain("min-h-12");
  });
  it("hasil negatif tidak memuat pernyataan Enhanced atau kode, dan jelas bahwa Enhanced tidak terbit", () => {
    for (const [outcome, title] of [["COMPLETED_WITH_NOTES", "tanpa Enhanced"], ["INCONCLUSIVE", "belum dapat disimpulkan"], ["REFERRED_SPECIAL_CASE", "Special Legal Case"]] as const) {
      const h = renderToStaticMarkup(DeepResult({ deep: deep({ outcome, verification: null, decisionReason: "Kriteria M3 tidak terpenuhi" }) }));
      expect(h).toContain(title);
      expect(h).toContain("tidak menghasilkan lencana Enhanced");
      expect(h).not.toContain(VERIFICATION_STATEMENTS.LEGAL_ENHANCED);
      expect(h).toContain("Kriteria M3 tidak terpenuhi");
    }
  });
  it("Enhanced dicabut atau ditangguhkan: tidak ada klaim Enhanced disetujui sebagai kondisi saat ini", () => {
    for (const status of ["SUSPENDED", "REVOKED"]) {
      const h = renderToStaticMarkup(DeepResult({ deep: deep({ verification: { code: "e".repeat(48), status } }) }));
      expect(h).not.toContain("Selesai: Enhanced disetujui");
      expect(h).not.toContain(VERIFICATION_STATEMENTS.LEGAL_ENHANCED);
      expect(h).toContain(status === "SUSPENDED" ? "Ditangguhkan sementara" : "Dicabut");
    }
  });
  it("ditangguhkan dan ditahan ditampilkan eksplisit", () => {
    expect(renderToStaticMarkup(DeepResult({ deep: deep({ verification: { code: "e".repeat(48), status: "SUSPENDED" } }) }))).toContain("Ditangguhkan sementara");
    expect(renderToStaticMarkup(DeepResult({ deep: deep({ status: "ON_HOLD", outcome: null }) }))).toContain("Ditahan karena verifikasi Legal Review dicabut");
  });
});

// Fix round Task 20 (I1): pembelian Deep Review tetap dibuka walau rubrik Enhanced belum disetujui, tetapi tawaran harus jujur.
describe("tawaran Deep Review mengikuti status rubrik Enhanced dari server", () => {
  const PENDING = "Saat ini lencana Legal Verified Enhanced belum dapat diterbitkan karena pedoman pemeriksaan Enhanced belum disetujui. Deep Review tetap memberikan pemeriksaan lanjutan dan hasil tertulis dari pengacara.";
  it("rubrik disetujui: hasil yang mungkin termasuk persetujuan Enhanced; tanpa pemberitahuan rubrik", () => {
    const h = offer({}, true);
    expect(h).toContain("Hasil Deep Review dapat berupa persetujuan Enhanced, selesai dengan catatan");
    expect(h).not.toContain(PENDING);
    expect(h).not.toContain("data-enhanced-pending");
  });
  it("rubrik belum disetujui: pemberitahuan tampil sebelum tombol bayar; Enhanced tidak disebut sebagai hasil yang mungkin", () => {
    const h = offer({}, false);
    expect(ENHANCED_RUBRIC_PENDING).toBe(PENDING);
    expect(h).toContain(PENDING);
    expect(h.indexOf(PENDING)).toBeLessThan(h.indexOf("Lanjut ke pembayaran"));
    expect(h).toContain("Hasil Deep Review dapat berupa selesai dengan catatan, belum dapat disimpulkan, atau dirujuk sebagai Special Legal Case.");
    expect(h).not.toMatch(/persetujuan Enhanced/);
    // Pernyataan wajib pembayaran tetap utuh (penafian, bukan janji).
    expect(h).toContain(CHECKOUT_NOTE);
  });
  it("EnhancedRubricNotice: kosong bila disetujui, kalimat tetap bila belum", () => {
    expect(renderToStaticMarkup(EnhancedRubricNotice({ rubricApproved: true }) ?? "")).toBe("");
    expect(renderToStaticMarkup(EnhancedRubricNotice({ rubricApproved: false })!)).toContain(PENDING);
  });
  it("tawaran, rincian checkout Deep Review, dan status Deep Review pemilik memakai rubricApproved dari server", () => {
    const src = (p: string) => readFileSync(p, "utf8");
    for (const p of ["src/app/(app)/reviews/[id]/page.tsx", "src/app/(app)/reviews/[id]/deep/page.tsx"]) {
      expect(src(p), p).toMatch(/deepService\(\)\.rubricApproved\(\)/);
      expect(src(p), p).toMatch(/<DeepOffer [^>]*rubricApproved=\{rubricApproved\}/);
    }
    for (const p of ["src/app/(app)/checkout/[orderId]/page.tsx", "src/app/(app)/deep-reviews/[id]/page.tsx"]) {
      expect(src(p), p).toMatch(/deepService\(\)\.rubricApproved\(\)/);
      expect(src(p), p).toContain("<EnhancedRubricNotice rubricApproved={rubricApproved} />");
    }
    // Sumber sama dengan decide_deep / editor reviewer: rubric_approvals untuk RUBRIC_VERSION.
    expect(src("src/lib/deep/service.ts")).toMatch(/async rubricApproved\(\) \{\s*const \{ rows \} = await pool\.query\("select exists \(select 1 from rubric_approvals where policy_version = \$1\) as ok", \[RUBRIC_VERSION\]\)/);
  });
});

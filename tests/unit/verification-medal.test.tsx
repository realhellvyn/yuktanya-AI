import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AiReviewResult } from "@/components/ai-review/ai-review-result";
import { DeepResult } from "@/components/deep/deep-result";
import { ResultPanel } from "@/components/reviews/result-panel";
import { PublicVerification } from "@/components/verification/public-verification";
import { VerificationPanel } from "@/components/verification/verification-panel";
import { MARK_PATHS, MEDAL_PALETTE, MedalStaticSvg, VerificationMedal } from "@/components/verification/verification-medal";
import { VERIFICATION_STATEMENTS, VERIFICATION_TITLES } from "@/lib/copy";
import type { OwnerDeep } from "@/lib/deep/service";
import type { OwnerReview } from "@/lib/reviews/service";
import { MEDAL_TEXT, medalFor, type MedalTier } from "@/lib/verification/medal";
import type { PublicVerificationResult, VerificationView } from "@/lib/verification/service";

// Task 20: lencana medali bertingkat. Medali hanya memvisualkan rekaman verifikasi yang SUDAH ada (kind + status dari server):
// AI → bronze, LEGAL (WITH_NOTES/WITHIN_SCOPE) → silver, LEGAL_ENHANCED (ENHANCED_APPROVED) → gold; status bukan Aktif → tanpa medali.
const ROOT = process.cwd();
const CODE = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4";
const SHA = "e".repeat(64);
const KINDS = ["AI", "LEGAL", "LEGAL_ENHANCED"] as const;
const STATUSES = ["ACTIVE", "REVOKED", "SUSPENDED"] as const;
const OUTCOMES = ["COMPLETED", "WITH_NOTES", "WITHIN_SCOPE", "INCONCLUSIVE", "DECLINED", "ENHANCED_APPROVED", "COMPLETED_WITH_NOTES", null] as const;
const FORBIDDEN_BRONZE = /legal|\bsah\b|terjamin/i;
const tiersIn = (html: string) => [...html.matchAll(/data-medal="(\w+)"/g)].map((m) => m[1]);
// Teks yang terbaca (tanpa tag): dipakai untuk memeriksa kata terlarang di medali bronze.
const textOf = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const medalHtml = (html: string, tier: MedalTier) => {
  const m = new RegExp(`<div[^>]*data-medal="${tier}"[\\s\\S]*?</span></span></div>`).exec(html);
  expect(m, `medali ${tier} tidak ditemukan`).not.toBeNull();
  return m![0];
};

describe("pemetaan rekaman verifikasi → tingkat medali", () => {
  it("AI aktif → bronze; LEGAL aktif WITH_NOTES/WITHIN_SCOPE → silver; LEGAL_ENHANCED aktif ENHANCED_APPROVED → gold", () => {
    expect(medalFor("AI", "ACTIVE", "COMPLETED")).toEqual({ tier: "bronze", note: "Pemeriksaan Awal oleh AI" });
    expect(medalFor("LEGAL", "ACTIVE", "WITH_NOTES")).toEqual({ tier: "silver", note: "Legal Review · Dengan Catatan" });
    expect(medalFor("LEGAL", "ACTIVE", "WITHIN_SCOPE")).toEqual({ tier: "silver", note: "Legal Review · Sesuai Lingkup" });
    expect(medalFor("LEGAL_ENHANCED", "ACTIVE", "ENHANCED_APPROVED")).toEqual({ tier: "gold", note: "Pemeriksaan lanjutan profesional" });
  });

  it("status tidak aktif (dicabut/ditangguhkan) → tanpa medali untuk semua jenis", () => {
    for (const k of KINDS) for (const s of ["REVOKED", "SUSPENDED"] as const) for (const o of OUTCOMES) expect(medalFor(k, s, o), `${k}/${s}/${o}`).toBeNull();
  });

  it("hasil hukum tanpa lencana (INCONCLUSIVE, DECLINED, tanpa hasil) → tanpa medali; jenis tak dikenal → tanpa medali", () => {
    for (const o of ["INCONCLUSIVE", "DECLINED", null]) expect(medalFor("LEGAL", "ACTIVE", o)).toBeNull();
    expect(medalFor("LEGAL_ENHANCED", "ACTIVE", "COMPLETED_WITH_NOTES")).toBeNull();
    expect(medalFor("LEGAL_ENHANCED", "ACTIVE", null)).toBeNull();
    expect(medalFor("STAMP" as never, "ACTIVE", "COMPLETED")).toBeNull();
    expect(medalFor("AI", "ACTIVE" as never, "COMPLETED")?.tier).toBe("bronze");
    expect(medalFor("AI", "UNKNOWN" as never, "COMPLETED")).toBeNull();
  });

  it("bronze tidak pernah untuk LEGAL/LEGAL_ENHANCED; gold hanya dari LEGAL_ENHANCED aktif yang sah", () => {
    for (const k of KINDS) for (const s of STATUSES) for (const o of OUTCOMES) {
      const m = medalFor(k, s, o);
      if (m?.tier === "bronze") expect(k).toBe("AI");
      if (m?.tier === "gold") expect([k, s, o]).toEqual(["LEGAL_ENHANCED", "ACTIVE", "ENHANCED_APPROVED"]);
      if (m?.tier === "silver") expect(k).toBe("LEGAL");
    }
  });
});

describe("VerificationMedal: teks, cincin, mark, aksesibilitas", () => {
  const render = (tier: MedalTier, note?: string) => renderToStaticMarkup(createElement(VerificationMedal, { tier, note } as never));

  it("setiap tingkat bertuliskan tingkatnya (bukan hanya warna); grafis aria-hidden, teks terbaca", () => {
    const cases: [MedalTier, string, string][] = [
      ["bronze", "AI Verified", "Pemeriksaan Awal oleh AI"],
      ["silver", "Legal Verified", "Legal Review · Dengan Catatan"],
      ["gold", "Legal Verified Enhanced", "Pemeriksaan lanjutan profesional"],
    ];
    for (const [tier, label, note] of cases) {
      const h = render(tier, tier === "silver" ? note : undefined);
      expect(h).toContain(`data-medal="${tier}"`);
      expect(textOf(h)).toBe(`${label} ${note}`);
      expect(h).toMatch(/<svg aria-hidden="true"[^>]*focusable="false"/);
      expect(h).not.toMatch(/<svg[^>]*role=/);
      // Tulisan memakai heading/muted (≥4,5:1 di bg dan surface), bukan warna logam.
      expect(h).toContain("text-heading");
      expect(h).toContain("text-muted");
      expect(MEDAL_TEXT[tier].label).toBe(label);
    }
    expect(textOf(render("silver", "Legal Review · Sesuai Lingkup"))).toBe("Legal Verified Legal Review · Sesuai Lingkup");
  });

  it("bronze tidak memuat kata Legal, Sah, atau Terjamin", () => {
    expect(textOf(render("bronze"))).not.toMatch(FORBIDDEN_BRONZE);
    expect(`${MEDAL_TEXT.bronze.label} ${MEDAL_TEXT.bronze.note}`).not.toMatch(FORBIDDEN_BRONZE);
  });

  it("medali bukan logo: selalu cincin (lingkaran luar + bidang dalam), gold bercincin ganda, mark dari berkas brand kit", () => {
    const circles = (tier: MedalTier) => (render(tier).match(/<circle /g) ?? []).length;
    expect(circles("bronze")).toBe(2);
    expect(circles("silver")).toBe(2);
    expect(circles("gold")).toBe(3);
    const brand = readFileSync(join(ROOT, "public/brand/yuktanya-mark-small-navy.svg"), "utf8");
    const brandPaths = [...brand.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]);
    expect([...MARK_PATHS]).toEqual(brandPaths);
    for (const t of ["bronze", "silver", "gold"] as const) for (const d of brandPaths) expect(render(t)).toContain(`d="${d}"`);
  });

  it("ukuran kecil 32px tersedia dan tetap bertulisan", () => {
    const h = renderToStaticMarkup(createElement(VerificationMedal, { tier: "gold", size: "sm" }));
    expect(h).toMatch(/class="[^"]*\bh-8 w-8\b/);
    expect(textOf(h)).toBe("Legal Verified Enhanced Pemeriksaan lanjutan profesional");
  });
});

// WCAG 2.x: rasio kontras untuk garis tepi grafis (≥3:1) terhadap bg (cream) dan surface (putih).
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const css = readFileSync(join(ROOT, "src/app/globals.css"), "utf8");
const token = (n: string) => new RegExp(`--${n}:\\s*(#[0-9a-fA-F]{6});`).exec(css)![1];

describe("kontras grafis medali", () => {
  it.each(["bronze", "silver", "gold"] as const)("%s: tepi ≥3:1 di atas bg dan surface; mark navy ≥3:1 di atas bidang dalam", (tier) => {
    const p = MEDAL_PALETTE[tier];
    expect(ratio(p.edge, token("bg"))).toBeGreaterThanOrEqual(3);
    expect(ratio(p.edge, token("surface"))).toBeGreaterThanOrEqual(3);
    expect(ratio(token("navy"), p.face)).toBeGreaterThanOrEqual(3);
    // Tepi juga harus terpisah dari bidang dalam agar cincin terbaca di 32px.
    expect(ratio(p.edge, p.face)).toBeGreaterThanOrEqual(3);
  });
});

describe("tempat tampil", () => {
  const pub = (over: Record<string, unknown>) => renderToStaticMarkup(createElement(PublicVerification, {
    code: CODE,
    result: { status: "ACTIVE", kind: "LEGAL", issuedAt: "2026-10-16T18:00:00.000Z", sha256: SHA, scopeSummary: null, outcome: "WITH_NOTES", textExtracted: false, ...over } as PublicVerificationResult,
  }));

  it("/verify: AI aktif → bronze dengan penjelasan bukan pemeriksaan profesional; LEGAL → silver; LEGAL_ENHANCED → gold", () => {
    const ai = pub({ kind: "AI", outcome: "COMPLETED", textExtracted: true });
    expect(tiersIn(ai)).toEqual(["bronze"]);
    expect(ai).toContain(VERIFICATION_STATEMENTS.AI);
    expect(ai).toContain(VERIFICATION_TITLES.AI);
    expect(textOf(medalHtml(ai, "bronze"))).not.toMatch(FORBIDDEN_BRONZE);
    expect(tiersIn(pub({}))).toEqual(["silver"]);
    expect(textOf(pub({ outcome: "WITHIN_SCOPE" }))).toContain("Legal Review · Sesuai Lingkup");
    expect(tiersIn(pub({ kind: "LEGAL_ENHANCED", outcome: "ENHANCED_APPROVED" }))).toEqual(["gold"]);
  });

  it("/verify: dicabut/ditangguhkan/tidak ditemukan → tanpa medali, teks status tetap", () => {
    for (const k of KINDS) for (const s of ["REVOKED", "SUSPENDED"]) {
      const h = pub({ kind: k, status: s, outcome: k === "AI" ? "COMPLETED" : k === "LEGAL" ? "WITH_NOTES" : "ENHANCED_APPROVED" });
      expect(tiersIn(h), `${k}/${s}`).toEqual([]);
      expect(h).toContain(s === "REVOKED" ? "Dicabut" : "Ditangguhkan sementara");
    }
    expect(tiersIn(renderToStaticMarkup(createElement(PublicVerification, { code: CODE, result: { status: "NOT_FOUND" } })))).toEqual([]);
  });

  it("panel verifikasi dokumen pemilik: tingkat sesuai jenis; status tidak aktif tanpa medali", () => {
    const base = { code: CODE, sha256: SHA, issuedAt: "2026-10-16T05:00:00.000Z", scopeSummary: null };
    const vs: VerificationView[] = [
      { ...base, id: "a", kind: "AI", status: "ACTIVE", outcome: "COMPLETED" },
      { ...base, id: "b", kind: "LEGAL", status: "ACTIVE", outcome: "WITHIN_SCOPE" },
      { ...base, id: "c", kind: "LEGAL_ENHANCED", status: "ACTIVE", outcome: "ENHANCED_APPROVED" },
      { ...base, id: "d", kind: "AI", status: "REVOKED", outcome: "COMPLETED" },
      { ...base, id: "e", kind: "LEGAL", status: "SUSPENDED", outcome: "WITH_NOTES" },
    ];
    const h = renderToStaticMarkup(createElement(VerificationPanel, { verifications: vs, qrDataUrls: {}, urls: Object.fromEntries(vs.map((v) => [v.id, `https://y.example/verify/${v.id}`])) }));
    expect(tiersIn(h)).toEqual(["bronze", "silver", "gold"]);
    expect(h).toContain(VERIFICATION_STATEMENTS.AI);
    expect(h).toContain("Status: Dicabut");
    expect(h).toContain("Status: Ditangguhkan sementara");
    expect(textOf(medalHtml(h, "bronze"))).not.toMatch(FORBIDDEN_BRONZE);
  });

  const review = (over: Partial<OwnerReview> = {}): OwnerReview => ({
    requestId: "r", versionId: "v", status: "COMPLETED", outcome: "WITH_NOTES", createdAt: "2026-10-16T05:00:00.000Z", completedAt: "2026-10-17T05:00:00.000Z",
    title: "NDA", versionNo: 2, scope: "Klausul kerahasiaan", assumptions: null, summary: null, notes: [],
    verification: { id: "x", code: CODE, status: "ACTIVE" }, documentId: "d1", firmName: null,
    timeline: { orderedAt: null, paidAt: null, queuedAt: "2026-10-16T05:00:00.000Z", assignedAt: null, completedAt: "2026-10-17T05:00:00.000Z" },
    credit: null, ...over,
  });

  it("hasil Legal Review: silver dengan catatan/sesuai lingkup; dicabut, ditangguhkan, belum dapat disimpulkan → tanpa medali; tidak pernah gold", () => {
    const r = (o: Partial<OwnerReview>) => renderToStaticMarkup(createElement(ResultPanel, { review: review(o) }));
    expect(tiersIn(r({}))).toEqual(["silver"]);
    expect(textOf(r({}))).toContain("Legal Verified Legal Review · Dengan Catatan");
    expect(textOf(r({ outcome: "WITHIN_SCOPE" }))).toContain("Legal Verified Legal Review · Sesuai Lingkup");
    for (const status of ["REVOKED", "SUSPENDED"] as const) expect(tiersIn(r({ verification: { id: "x", code: CODE, status } }))).toEqual([]);
    expect(tiersIn(r({ outcome: "INCONCLUSIVE", verification: null }))).toEqual([]);
    expect(tiersIn(r({ status: "DECLINED", outcome: "DECLINED", verification: null }))).toEqual([]);
  });

  const deep = (over: Partial<OwnerDeep> = {}): OwnerDeep => ({
    deepId: "d", parentRequestId: "p", versionId: "v", status: "COMPLETED", outcome: "ENHANCED_APPROVED", createdAt: "2026-10-16T05:00:00.000Z", completedAt: "2026-10-17T05:00:00.000Z",
    extraWork: "Pemeriksaan identitas", summary: null, decision: "APPROVE", decisionReason: null, dispositions: [], verification: { code: CODE, status: "ACTIVE" }, ...over,
  });

  it("hasil Deep Review: gold hanya untuk Enhanced aktif; tanpa rekaman Enhanced atau status tidak aktif → tanpa medali", () => {
    const d = (o: Partial<OwnerDeep>) => renderToStaticMarkup(createElement(DeepResult, { deep: deep(o) }));
    expect(tiersIn(d({}))).toEqual(["gold"]);
    for (const status of ["REVOKED", "SUSPENDED"] as const) expect(tiersIn(d({ verification: { code: CODE, status } }))).toEqual([]);
    for (const outcome of ["COMPLETED_WITH_NOTES", "INCONCLUSIVE", "REFERRED_SPECIAL_CASE"]) expect(tiersIn(d({ outcome, verification: null }))).toEqual([]);
    expect(tiersIn(d({ status: "IN_REVIEW", outcome: null, verification: null }))).toEqual([]);
  });

  it("gold tidak pernah dirender bila data tidak memuat rekaman Enhanced yang sah", () => {
    const base = { code: CODE, sha256: SHA, issuedAt: "2026-10-16T05:00:00.000Z", scopeSummary: null };
    const html = [
      renderToStaticMarkup(createElement(VerificationPanel, { verifications: [{ ...base, id: "a", kind: "AI", status: "ACTIVE", outcome: "COMPLETED" }, { ...base, id: "b", kind: "LEGAL", status: "ACTIVE", outcome: "WITH_NOTES" }], qrDataUrls: {}, urls: { a: "u", b: "u" } })),
      renderToStaticMarkup(createElement(ResultPanel, { review: review({ outcome: "WITHIN_SCOPE" }) })),
      renderToStaticMarkup(createElement(DeepResult, { deep: deep({ outcome: "COMPLETED_WITH_NOTES", verification: null }) })),
      renderToStaticMarkup(createElement(DeepResult, { deep: deep({ verification: { code: CODE, status: "SUSPENDED" } }) })),
      pub({ kind: "LEGAL_ENHANCED", status: "REVOKED", outcome: "ENHANCED_APPROVED" }),
    ].join("\n");
    expect(tiersIn(html)).not.toContain("gold");
  });

  const report = { perhatian: ["Periksa tanggal"], belumJelas: [], pertanyaanUntukPengacara: [] };
  it("laporan AI dokumen unggahan dengan AI Verified → bronze + penjelasan bukan pemeriksaan profesional", () => {
    const h = renderToStaticMarkup(createElement(AiReviewResult, { report, completedAt: "2026-10-16T05:00:00Z", verified: true }));
    expect(tiersIn(h)).toEqual(["bronze"]);
    expect(h).toContain(VERIFICATION_STATEMENTS.AI);
    expect(h).toContain("Bukan Legal Verified");
    expect(textOf(medalHtml(h, "bronze"))).not.toMatch(FORBIDDEN_BRONZE);
  });

  it("laporan AI dokumen hasil template (tanpa rekaman AI Verified) → tanpa medali", () => {
    const h = renderToStaticMarkup(createElement(AiReviewResult, { report, completedAt: "2026-10-16T05:00:00Z", verified: false }));
    expect(tiersIn(h)).toEqual([]);
    expect(h).not.toContain(VERIFICATION_TITLES.AI);
  });
});

// --- Aturan sumber ---
function files(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) files(p, out); else if (/\.(ts|tsx)$/.test(p)) out.push(p); }
  return out;
}
const SRC = files(join(ROOT, "src"));
const rel = (f: string) => f.slice(ROOT.length + 1);

describe("medali hanya di tempat verifikasi tampil", () => {
  it("segel lingkaran-centang lama sudah diganti", () => {
    expect(existsSync(join(ROOT, "src/components/verification/verification-seal.tsx"))).toBe(false);
    expect(SRC.filter((f) => /VerificationSeal|data-seal/.test(readFileSync(f, "utf8"))).map(rel)).toEqual([]);
  });

  it("medali tidak dipakai sebagai logo atau hiasan: hanya di komponen tampilan verifikasi yang tercatat", () => {
    const users = SRC.filter((f) => /\b(VerificationMedal|MedalGraphic)\b/.test(readFileSync(f, "utf8"))).map(rel).sort();
    expect(users).toEqual([
      "src/app/(admin)/admin/verifications/page.tsx",
      "src/components/ai-review/ai-review-result.tsx",
      "src/components/deep/deep-result.tsx",
      "src/components/reviews/result-panel.tsx",
      "src/components/verification/public-verification.tsx",
      "src/components/verification/verification-medal.tsx",
      "src/components/verification/verification-panel.tsx",
    ]);
    // Daftar admin: medali bronze disertai pernyataan AI (bukan pemeriksaan profesional).
    expect(readFileSync(join(ROOT, "src/app/(admin)/admin/verifications/page.tsx"), "utf8")).toContain('{r.kind === "AI" && <p>{VERIFICATION_STATEMENTS.AI}</p>}');
    // Header dan logo tetap memakai mark polos, tanpa medali.
    expect(readFileSync(join(ROOT, "src/components/brand-logo.tsx"), "utf8")).not.toMatch(/medal/i);
  });
});

describe("salinan SVG statis untuk dokumentasi", () => {
  it.each(["bronze", "silver", "gold"] as const)("public/brand/medals/medal-%s.svg sama dengan komponen (dengan tulisan)", (tier) => {
    const svg = renderToStaticMarkup(createElement(MedalStaticSvg, { tier })) + "\n";
    const path = join(ROOT, `public/brand/medals/medal-${tier}.svg`);
    if (process.env.UPDATE_MEDALS === "1") writeFileSync(path, svg);
    expect(readFileSync(path, "utf8")).toBe(svg);
    expect(svg).toContain(MEDAL_TEXT[tier].label);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  });
});

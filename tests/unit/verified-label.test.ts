import JSZip from "jszip";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DeepResult } from "@/components/deep/deep-result";
import { ResultPanel } from "@/components/reviews/result-panel";
import { PublicVerification } from "@/components/verification/public-verification";
import { VerificationPanel } from "@/components/verification/verification-panel";
import * as copy from "@/lib/copy";
import { exportDocx } from "@/lib/documents/export";
import type { OwnerDeep } from "@/lib/deep/service";
import type { OwnerReview } from "@/lib/reviews/service";
import type { PublicVerificationResult } from "@/lib/verification/service";

// B-03 / D-18: label Verified wajib (SECURITY_AND_LEGAL.md "Mandatory copy"), persis kata demi kata.
const LABEL = "Dokumen versi ini telah diperiksa oleh profesional hukum sesuai ruang lingkup review yang tercantum. Tidak menjamin keabsahan atau hasil hukum tertentu.";
const CODE = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4";
const SHA = "e".repeat(64);

const review = (over: Partial<OwnerReview> = {}): OwnerReview => ({
  requestId: "r", versionId: "v", status: "COMPLETED", outcome: "WITH_NOTES", createdAt: "2026-10-16T05:00:00.000Z", completedAt: "2026-10-17T05:00:00.000Z",
  title: "NDA", versionNo: 2, scope: "Klausul kerahasiaan", assumptions: null, summary: null, notes: [],
  verification: { id: "x", code: CODE, status: "ACTIVE" }, ...over,
});
const deep = (over: Partial<OwnerDeep> = {}): OwnerDeep => ({
  deepId: "d", parentRequestId: "p", versionId: "v", status: "COMPLETED", outcome: "ENHANCED_APPROVED", createdAt: "2026-10-16T05:00:00.000Z", completedAt: "2026-10-17T05:00:00.000Z",
  extraWork: "Pemeriksaan identitas", summary: null, decision: "APPROVE", decisionReason: null, dispositions: [], verification: { code: CODE, status: "ACTIVE" }, ...over,
});
const pub = (over: Partial<Extract<PublicVerificationResult, { kind: unknown }>> = {}) => renderToStaticMarkup(PublicVerification({
  code: CODE, result: { status: "ACTIVE", kind: "LEGAL", issuedAt: "2026-10-16T18:00:00.000Z", sha256: SHA, scopeSummary: null, outcome: "WITH_NOTES", ...over } as PublicVerificationResult,
}));

describe("label Verified wajib", () => {
  it("konstanta VERIFIED_LABEL persis sama dengan teks wajib", () => {
    expect((copy as Record<string, unknown>).VERIFIED_LABEL).toBe(LABEL);
  });

  it("halaman hasil Legal Verified pemilik (dengan dan tanpa Legal Note) dan hasil Enhanced memuat label; hasil tanpa lencana atau dicabut tidak", () => {
    expect(renderToStaticMarkup(ResultPanel({ review: review() }))).toContain(LABEL);
    expect(renderToStaticMarkup(ResultPanel({ review: review({ outcome: "WITHIN_SCOPE" }) }))).toContain(LABEL);
    expect(renderToStaticMarkup(ResultPanel({ review: review({ outcome: "INCONCLUSIVE", verification: null }) }))).not.toContain(LABEL);
    expect(renderToStaticMarkup(ResultPanel({ review: review({ verification: { id: "x", code: CODE, status: "REVOKED" } }) }))).not.toContain(LABEL);
    expect(renderToStaticMarkup(DeepResult({ deep: deep() }))).toContain(LABEL);
    expect(renderToStaticMarkup(DeepResult({ deep: deep({ verification: { code: CODE, status: "SUSPENDED" } }) }))).not.toContain(LABEL);
  });

  it("halaman publik /verify: LEGAL dan LEGAL_ENHANCED aktif memuat label; AI dan status dicabut/ditangguhkan tidak", () => {
    expect(pub()).toContain(LABEL);
    expect(pub({ kind: "LEGAL_ENHANCED", outcome: "ENHANCED_APPROVED" })).toContain(LABEL);
    expect(pub({ kind: "AI", outcome: "COMPLETED" })).not.toContain(LABEL);
    expect(pub({ status: "REVOKED" } as never)).not.toContain(LABEL);
    expect(pub({ status: "SUSPENDED", kind: "LEGAL_ENHANCED" } as never)).not.toContain(LABEL);
  });

  it("panel verifikasi dokumen pemilik memuat label hanya untuk verifikasi hukum yang aktif", () => {
    const base = { id: "v1", code: CODE, sha256: SHA, issuedAt: "2026-10-16T05:00:00.000Z", scopeSummary: null };
    const h = (kind: "AI" | "LEGAL" | "LEGAL_ENHANCED", status: "ACTIVE" | "REVOKED") =>
      renderToStaticMarkup(VerificationPanel({ verifications: [{ ...base, kind, status, outcome: kind === "AI" ? "COMPLETED" : "WITH_NOTES" }], qrDataUrls: {}, urls: { v1: "https://y.example/verify/x" } }));
    expect(h("LEGAL", "ACTIVE")).toContain(LABEL);
    expect(h("LEGAL_ENHANCED", "ACTIVE")).toContain(LABEL);
    expect(h("AI", "ACTIVE")).not.toContain(LABEL);
    expect(h("LEGAL", "REVOKED")).not.toContain(LABEL);
  });

  it("blok verifikasi ekspor: pernyataan hukum memuat label persis; AI tidak; DOCX memuatnya", async () => {
    const statement = (copy as unknown as { exportVerificationStatement(kind: string, outcome: string | null): string }).exportVerificationStatement;
    expect(statement("LEGAL", "WITH_NOTES").split("\n")).toContain(LABEL);
    expect(statement("LEGAL_ENHANCED", "ENHANCED_APPROVED").split("\n")).toContain(LABEL);
    expect(statement("AI", "COMPLETED")).not.toContain(LABEL);
    const bytes = await exportDocx({ label: "NDA", blocks: [{ id: "t", kind: "title", text: "Perjanjian" }] } as never, {
      kindTitle: "Yuktanya Legal Verified", statement: statement("LEGAL", "WITHIN_SCOPE"), code: CODE, url: "https://y.example/verify/x", originalSha256: SHA,
      qrPng: new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64")),
    });
    const xml = await (await JSZip.loadAsync(bytes)).file("word/document.xml")!.async("string");
    expect(xml).toContain(LABEL);
  });
});

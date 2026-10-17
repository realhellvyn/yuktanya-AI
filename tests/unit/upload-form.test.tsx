import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UploadForm, fileTooLarge } from "@/components/ai-review/upload-form";
import { AiReviewForm } from "@/components/ai-review/ai-review-form";
import { MAX_UPLOAD_BYTES } from "@/lib/uploads/limits";

describe("Fix round 1 (I1): pemeriksaan ukuran di perangkat sebelum mengirim", () => {
  it("berkas > 4 MB ditandai terlalu besar; tepat 4 MB dan tanpa berkas tidak", () => {
    expect(fileTooLarge(MAX_UPLOAD_BYTES + 1)).toBe(true);
    expect(fileTooLarge(MAX_UPLOAD_BYTES)).toBe(false);
    expect(fileTooLarge(undefined)).toBe(false);
  });
  it("formulir unggah: belum ada pesan terlalu besar saat awal; tombol aktif", () => {
    const h = renderToStaticMarkup(createElement(UploadForm, { action: async () => ({}), idempotencyKey: "k-123456789" }));
    expect(h).not.toContain("Ukuran maksimal 4 MB");
    expect(h).toMatch(/<button[^>]*type="submit"(?![^>]*disabled)/);
  });
});

describe("Fix round 1 (M6): formulir analisis AI di halaman dokumen", () => {
  it("memuat versi, dokumen, persetujuan wajib, tombol kirim, dan wilayah progres aria-live", () => {
    const h = renderToStaticMarkup(createElement(AiReviewForm, { action: async () => {}, versionId: "v1", documentId: "d1", consentText: "Saya setuju.", again: false }));
    expect(h).toContain('name="versionId" value="v1"');
    expect(h).toContain('name="documentId" value="d1"');
    expect(h).toMatch(/<input type="checkbox" required=""[^>]*name="consent"/);
    expect(h).toContain("Mulai analisis awal AI");
    expect(h).toContain('data-testid="ai-lambat"');
    const again = renderToStaticMarkup(createElement(AiReviewForm, { action: async () => {}, versionId: "v1", documentId: "d1", consentText: "x", again: true }));
    expect(again).toContain("Ulangi analisis awal AI");
  });
});

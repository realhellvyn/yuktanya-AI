import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { HomeDocumentPreview, SAMPLE_LOAN, sampleLoanPreview } from "@/components/documents/home-document-preview";
import { renderDocument } from "@/lib/documents/render";
import { utangPiutang } from "@/lib/documents/templates/utang-piutang";
import Home from "@/app/(public)/page";

// Task 19: pratinjau Surat Utang Piutang di beranda dirender oleh renderer template aplikasi, bukan teks statis.
describe("pratinjau dokumen di beranda", () => {
  const html = renderToStaticMarkup(createElement(HomeDocumentPreview));

  it("data contoh lolos validasi template yang sama dengan aplikasi", () => {
    expect(utangPiutang.validate(SAMPLE_LOAN).ok).toBe(true);
  });

  it("setiap judul dan pasal sama persis dengan keluaran renderDocument()", () => {
    const doc = renderDocument(utangPiutang, SAMPLE_LOAN, "DRAFT");
    const esc = (s: string) => renderToStaticMarkup(createElement("span", null, s)).slice(6, -7);
    expect(html).toContain(esc(doc.blocks.find((b) => b.kind === "title")!.text));
    const clauses = sampleLoanPreview().clauses;
    expect(clauses.length).toBeGreaterThanOrEqual(3);
    for (const c of clauses) {
      expect(doc.blocks.some((b) => b.kind === "paragraph" && b.text === c.text)).toBe(true);
      expect(html).toContain(esc(c.text));
      expect(html).toContain(esc(c.heading));
    }
    // Nilai yang hanya muncul bila renderer mengisi placeholder: format rupiah, tanggal Indonesia, nama pengadilan.
    for (const s of ["Rp5.000.000", "17 Oktober 2026", "Sinta Dewi", "Budi Santoso", "Pengadilan Negeri Jakarta Selatan"]) expect(html).toContain(s);
    expect(html).toContain("Pasal 1");
  });

  it("teks pasal tidak ditulis manual di komponen (sumber tidak memuat klausul template)", () => {
    const src = readFileSync(join(process.cwd(), "src/components/documents/home-document-preview.tsx"), "utf8");
    for (const c of utangPiutang.clauses) expect(src).not.toContain(c.text.slice(0, 30));
    expect(src).toContain("renderDocument(");
  });

  it("tanpa lencana, label tambahan, catatan persetujuan template, tanda tangan, QR, atau kode verifikasi", () => {
    expect(html).not.toMatch(/Legal Verified/i);
    expect(html).not.toMatch(/contoh|fiktif|bukan dokumen sungguhan/i);
    expect(html).not.toContain("Template belum disetujui");
    expect(html).not.toMatch(/<img|<svg|tanda tangan|kode verifikasi|QR/i);
  });

  it("tampil juga di layar kecil dan punya judul yang dibaca pembaca layar", () => {
    // Tidak ada kelas "hidden" (atau sm:/md:/lg:hidden) yang menyembunyikan pratinjau di layar mana pun.
    expect(html).not.toMatch(/class="(?:[^"]*\s)?(?:[a-z]+:)?hidden(?:\s[^"]*)?"/);
    expect(html).not.toContain('aria-hidden="true" class="relative');
    expect(html).toMatch(/<figure aria-labelledby="pratinjau-dokumen-h"/);
    expect(html).toMatch(/<h2 id="pratinjau-dokumen-h"[^>]*>Surat Utang Piutang<\/h2>/);
  });

  it("beranda memuat pratinjau, bukan kartu kerangka lama", () => {
    const home = renderToStaticMarkup(createElement(Home));
    expect(home).toContain("pratinjau-dokumen-h");
    expect(home).not.toContain("Contoh tampilan (bukan dokumen sungguhan)");
    expect(home).not.toMatch(/Legal Verified/);
  });
});

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
import HomePage from "@/app/(public)/page";
import { DocumentPreview } from "@/components/documents/document-preview";
import { PartialPreview } from "@/components/documents/partial-preview";
import { AI_DRAFT_LABEL } from "@/lib/copy";
import { renderDocument } from "@/lib/documents/render";
import { nda } from "@/lib/documents/templates/nda";

// D-22: salinan wajib (label draf AI, analisis awal AI, pernyataan Verified) tidak boleh lebih kecil dari text-base.
const classOfParagraphWith = (html: string, text: string) => {
  const m = new RegExp(`<p[^>]*class="([^"]*)"[^>]*>${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).exec(html);
  expect(m, `paragraf dengan teks "${text}" tidak ditemukan`).not.toBeNull();
  return m![1];
};

describe("salinan wajib terbaca jelas (D-22)", () => {
  it("beranda publik: label draf AI di bawah tombol memakai text-base", async () => {
    const html = renderToStaticMarkup(await HomePage());
    const cls = classOfParagraphWith(html, AI_DRAFT_LABEL);
    expect(cls).toContain("text-base");
    expect(cls).not.toMatch(/\btext-(xs|sm)\b/);
  });
  it("pratinjau bertahap dan pratinjau dokumen memakai text-base", () => {
    const partial = renderToStaticMarkup(PartialPreview({ title: "NDA", rows: [] }));
    expect(classOfParagraphWith(partial, AI_DRAFT_LABEL)).toContain("text-base");
    expect(classOfParagraphWith(partial, AI_DRAFT_LABEL)).not.toMatch(/\btext-(xs|sm)\b/);
    const doc = renderToStaticMarkup(DocumentPreview({ doc: renderDocument(nda, { disclosingParty: "A", receivingParty: "B", signingDate: "2026-10-16", confidentialInfo: "I", purpose: "T", termMonths: 24, disputeCity: "Jakarta" }, "DRAFT") }));
    expect(classOfParagraphWith(doc, AI_DRAFT_LABEL)).toContain("text-base");
    expect(classOfParagraphWith(doc, AI_DRAFT_LABEL)).not.toMatch(/\btext-(xs|sm)\b/);
  });
  it("tidak ada baris sumber yang menampilkan label wajib dengan text-xs/text-sm", () => {
    const files: string[] = [];
    const walk = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx$/.test(p)) files.push(p); } };
    walk(join(process.cwd(), "src"));
    const offenders: string[] = [];
    for (const f of files) {
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (/\{(AI_DRAFT_LABEL|AI_PREREVIEW_LABEL|VERIFIED_LABEL|doc\.label)\}/.test(line) && /\btext-(xs|sm)\b/.test(line)) offenders.push(`${f}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

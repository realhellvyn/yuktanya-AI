import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));
import { DocumentPreview } from "@/components/documents/document-preview";
import { VersionList } from "@/components/documents/version-list";
import { BottomNav, SideNav } from "@/components/app-nav";
import { WizardStep } from "@/components/documents/wizard-step";
import { AI_DRAFT_LABEL } from "@/lib/copy";
import { renderDocument } from "@/lib/documents/render";
import { nda } from "@/lib/documents/templates/nda";
import { utangPiutang } from "@/lib/documents/templates/utang-piutang";
import { buildSteps } from "@/lib/documents/wizard";
import type { Data } from "@/lib/documents/types";

const noop = async () => {};
const step = (key: string) => buildSteps(utangPiutang).find((s) => s.field.key === key)!;
const stepHtml = (key: string, over: Partial<Parameters<typeof WizardStep>[0]> = {}) =>
  renderToStaticMarkup(WizardStep({ step: step(key), documentId: "d1", revision: 3, action: noop, ...over }));

const data: Data = {
  disclosingParty: "Sinta Dewi", receivingParty: "Budi Santoso", signingDate: "2026-10-16", confidentialInfo: "Info",
  purpose: "Tujuan", termMonths: 24, disputeCity: "Jakarta",
};

describe("WizardStep", () => {
  it("memuat label, Wajib, contoh, penjelasan, serta tombol Kembali dan Lanjut", () => {
    const html = stepHtml("principalIdr", { backHref: "/workspace/d1?step=3" });
    expect(html).toContain("Jumlah pinjaman (rupiah)");
    expect(html).toContain("Wajib");
    expect(html).toContain("Contoh: Rp5.000.000");
    expect(html).toContain("Mengapa informasi ini diperlukan?");
    expect(html).toContain("Kembali");
    expect(html).toContain("Lanjut");
    expect(html).toContain('href="/workspace/d1?step=3"');
  });

  it("field opsional ditandai Opsional dan label terhubung ke input", () => {
    const html = stepHtml("repaymentNote");
    expect(html).toContain("Opsional");
    const id = /<label[^>]*for="([^"]+)"/.exec(html)![1];
    expect(html).toContain(`id="${id}"`);
  });

  it("galat tampil sebagai role=alert dan dikaitkan ke input; nilai lama dipertahankan", () => {
    const html = stepHtml("creditor", { error: "Wajib diisi", value: "Rina" });
    expect(html).toContain('role="alert"');
    expect(html).toContain("Wajib diisi");
    expect(html).toMatch(/aria-describedby="[^"]*error[^"]*"/);
    expect(html).toContain('value="Rina"');
  });

  it("langkah pertama tanpa backHref tidak menampilkan tautan Kembali", () => {
    expect(stepHtml("creditor")).not.toContain(">Kembali<");
  });
});

describe("DocumentPreview dan VersionList", () => {
  it("pratinjau selalu memuat label draf AI dan isi dokumen", () => {
    const html = renderToStaticMarkup(DocumentPreview({ doc: renderDocument(nda, data, "DRAFT") }));
    expect(html).toContain(AI_DRAFT_LABEL);
    expect(html).toContain("Sinta Dewi");
  });

  it("daftar versi: belum diperiksa, hash 12 karakter, tanpa badge", () => {
    const html = renderToStaticMarkup(VersionList({
      documentId: "d1",
      versions: [{ id: "v1", versionNo: 1, sha256: "a".repeat(64), createdAt: "2026-10-16T05:00:00.000Z" }],
    }));
    expect(html).toContain("Versi baru belum diperiksa");
    expect(html).toContain("aaaaaaaaaaaa");
    expect(html).not.toContain("aaaaaaaaaaaaa");
    expect(html).not.toMatch(/Verified/i);
  });

  it("setiap tautan di daftar versi dan menu punya tinggi minimal 48px (min-h-12)", () => {
    const list = renderToStaticMarkup(VersionList({
      documentId: "d1",
      versions: [
        { id: "v1", versionNo: 1, sha256: "a".repeat(64), createdAt: "2026-10-16T05:00:00.000Z" },
        { id: "v2", versionNo: 2, sha256: "b".repeat(64), createdAt: "2026-10-16T06:00:00.000Z" },
      ],
    }));
    const nav = [renderToStaticMarkup(SideNav()), renderToStaticMarkup(BottomNav())];
    for (const html of [list, ...nav]) {
      const anchors = html.match(/<a [^>]*>/g) ?? [];
      expect(anchors.length).toBeGreaterThan(0);
      for (const a of anchors) expect(a).toMatch(/min-h-(12|16)/);
    }
  });

  it("tidak ada kata 'cap' di keluaran komponen", () => {
    const all = [stepHtml("principalIdr"), renderToStaticMarkup(DocumentPreview({ doc: renderDocument(nda, data, "DRAFT") }))].join(" ");
    expect(all).not.toMatch(/\bcap\b/i);
  });
});

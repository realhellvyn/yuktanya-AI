import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));
import { DocumentPreview } from "@/components/documents/document-preview";
import { VersionList } from "@/components/documents/version-list";
import { BottomNav, SideNav } from "@/components/app-nav";
import { ChatPanel } from "@/components/documents/chat-panel";
import { AI_DRAFT_LABEL } from "@/lib/copy";
import { renderDocument } from "@/lib/documents/render";
import { nda } from "@/lib/documents/templates/nda";
import type { Data } from "@/lib/documents/types";


const data: Data = {
  disclosingParty: "Sinta Dewi", receivingParty: "Budi Santoso", signingDate: "2026-10-16", confidentialInfo: "Info",
  purpose: "Tujuan", termMonths: 24, disputeCity: "Jakarta",
};

describe("ChatPanel", () => {
  const noop2 = async () => {};
  const html = (over: Partial<Parameters<typeof ChatPanel>[0]> = {}) =>
    renderToStaticMarkup(createElement(ChatPanel, { documentId: "d1", lines: [], greeting: "Halo!", action: noop2, sendKey: "k1", retryKey: "k2", hasUnanswered: false, placeholder: "Contoh", userId: "u1", ...over }));

  it("memuat sapaan, kotak pesan berlabel, dan tidak ada isian per-kolom manual", () => {
    const h = html();
    expect(h).toContain("Halo!");
    expect(h).toMatch(/<label[^>]*>[\s\S]*Pesan Anda/);
    expect(h).toContain('name="message"');
    expect(h).not.toContain('name="value"');
    expect(h).not.toContain('name="fieldKey"');
  });

  it("pesan ditampilkan dengan penanda pembicara untuk pembaca layar", () => {
    const h = html({ lines: [{ id: "1", role: "user", content: "Saya Sinta" }, { id: "2", role: "assistant", content: "Siapa pihak kedua?" }] });
    expect(h).toContain("Anda: ");
    expect(h).toContain("AI: ");
    expect(h).toContain("Siapa pihak kedua?");
  });

  it("pesan belum terjawab menampilkan Coba lagi dengan kunci idempoten sendiri", () => {
    const h = html({ hasUnanswered: true });
    expect(h).toContain("Coba lagi");
    expect(h).toContain('name="retry"');
    expect(h).toContain('value="k2"');
    expect(html()).not.toContain("Coba lagi");
  });
});

describe("DocumentPreview dan VersionList", () => {
  it("pratinjau selalu memuat label draf AI dan isi dokumen", () => {
    const html = renderToStaticMarkup(DocumentPreview({ doc: renderDocument(nda, data, "DRAFT") }));
    expect(html).toContain(AI_DRAFT_LABEL);
    expect(html).toContain("Sinta Dewi");
  });

  it("daftar versi: status nyata per versi (D-04) — versi diperiksa memegang hasilnya, versi baru belum diperiksa", () => {
    const versions = [
      { id: "v1", versionNo: 1, sha256: "a".repeat(64), createdAt: "2026-10-16T05:00:00.000Z" },
      { id: "v2", versionNo: 2, sha256: "b".repeat(64), createdAt: "2026-10-16T06:00:00.000Z" },
    ];
    const reviewed = { review: "COMPLETED", outcome: "WITH_NOTES", legal: "ACTIVE" as const, enhanced: null, ai: false };
    const h = renderToStaticMarkup(VersionList({ documentId: "d1", versions, statuses: { v1: reviewed } }));
    expect(h.indexOf("Sudah diperiksa pengacara — Legal Verified aktif")).toBeGreaterThan(-1);
    expect(h.indexOf("Sudah diperiksa pengacara")).toBeLessThan(h.indexOf("Versi 2"));
    expect(h).toContain("Versi baru belum diperiksa");
    const revoked = renderToStaticMarkup(VersionList({ documentId: "d1", versions: versions.slice(0, 1), statuses: { v1: { ...reviewed, legal: "REVOKED" } } }));
    expect(revoked).toContain("verifikasi dicabut");
    expect(revoked).not.toContain("belum diperiksa");
    const inflight = renderToStaticMarkup(VersionList({ documentId: "d1", versions: versions.slice(0, 1), statuses: { v1: { review: "IN_REVIEW", outcome: null, legal: null, enhanced: null, ai: false } } }));
    expect(inflight).toContain("Sedang dalam pemeriksaan pengacara");
  });

  it("daftar versi: belum diperiksa, hash 12 karakter, tanpa badge", () => {
    const html = renderToStaticMarkup(VersionList({
      documentId: "d1",
      versions: [{ id: "v1", versionNo: 1, sha256: "a".repeat(64), createdAt: "2026-10-16T05:00:00.000Z" }],
    }));
    expect(html).toContain("Belum diperiksa pengacara");
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
    const all = [renderToStaticMarkup(DocumentPreview({ doc: renderDocument(nda, data, "DRAFT") }))].join(" ");
    expect(all).not.toMatch(/\bcap\b/i);
  });
});

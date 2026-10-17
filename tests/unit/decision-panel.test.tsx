import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DecisionPanel } from "@/components/partner/decision-panel";

const render = (authorized: boolean) =>
  renderToStaticMarkup(createElement(DecisionPanel, {
    action: async () => {}, deepId: "d1", revision: 1, title: "Dokumen", versionNo: 1, sha256: "a".repeat(64),
    parentScope: "Ruang lingkup", approveBlockers: [], unresolved: [], authorized,
  }));
const submitTag = (h: string) => (h.match(/<button [^>]*>Simpan keputusan<\/button>/) ?? [""])[0];

describe("DecisionPanel", () => {
  it("tanpa otorisasi aktif: tombol nonaktif dan alasan tertulis, termasuk keputusan non-Enhanced (bawaan)", () => {
    const h = render(false);
    expect(submitTag(h)).toContain("disabled");
    expect(h).toContain("Otorisasi profesional Anda tidak aktif. Hubungi koordinator.");
  });
  it("dengan otorisasi aktif: tidak ada alasan otorisasi", () => {
    expect(render(true)).not.toContain("Otorisasi profesional Anda tidak aktif");
  });
});

describe("pernyataan tidak ada konflik kepentingan (B-02)", () => {
  it("dialog keputusan memuat kotak centang noConflict dan tombol simpan nonaktif sampai dicentang", () => {
    const h = render(true);
    expect(h).toMatch(/<input type="checkbox"[^>]*name="noConflict" value="yes"/);
    expect(h).toContain("tidak ada konflik kepentingan");
    expect((h.match(/<button [^>]*>Ya, simpan keputusan<\/button>/) ?? [""])[0]).toContain("disabled");
  });
  it("dialog terbit Review Standar juga mewajibkannya", async () => {
    const { PublishPanel } = await import("@/components/partner/publish-panel");
    const h = renderToStaticMarkup(createElement(PublishPanel, {
      action: async () => {}, requestId: "r1", revision: 1, title: "Dokumen", versionNo: 1, sha256: "a".repeat(64), scope: "Lingkup", summary: "", notes: [], authorized: true,
    }));
    expect(h).toMatch(/<input type="checkbox"[^>]*name="noConflict" value="yes"/);
    expect((h.match(/<button [^>]*>Ya, terbitkan sekarang<\/button>/) ?? [""])[0]).toContain("disabled");
  });
  it("keputusan selain Setujui menampilkan isi reviewer sebelumnya yang belum dikonfirmasi", () => {
    const h = renderToStaticMarkup(createElement(DecisionPanel, {
      action: async () => {}, deepId: "d1", revision: 1, title: "Dokumen", versionNo: 1, sha256: "a".repeat(64),
      parentScope: "Ruang lingkup", approveBlockers: [], unresolved: [], authorized: true, confirmBlockers: ["Tindak lanjut catatan 1 diisi pemeriksa sebelumnya. Periksa isinya, lalu simpan ulang."],
    }));
    expect(h).toContain("Tindak lanjut catatan 1 diisi pemeriksa sebelumnya");
  });
});

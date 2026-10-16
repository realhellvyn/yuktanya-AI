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

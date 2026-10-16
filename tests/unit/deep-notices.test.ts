import { describe, expect, it } from "vitest";
import { deepNoticeText } from "@/lib/deep/notices";

describe("deepNoticeText", () => {
  it("kode dikenal → kalimat tetap", () => {
    expect(deepNoticeText("NO_ACTIONABLE_NOTES")).toBe("Pemeriksaan mendalam belum dapat dipesan. Pemeriksaan standar tidak memiliki catatan yang perlu ditindaklanjuti.");
  });
  it("teks bebas, HTML, kunci prototipe, dan bukan-string tidak pernah ditampilkan", () => {
    for (const bad of ["Hubungi 0812-0000 untuk hadiah", "<b>x</b>", "constructor", "__proto__", "toString", "", undefined, ["NOT_FOUND"], 5]) expect(deepNoticeText(bad)).toBeNull();
  });
});

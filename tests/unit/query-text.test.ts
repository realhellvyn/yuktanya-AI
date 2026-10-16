import { describe, expect, it } from "vitest";
import { fixedText, isUuid, maskEmail } from "@/lib/query-text";

// D-05: teks dari alamat (?error=, ?notice=, ?e=) tidak pernah ditampilkan apa adanya; hanya kode dikenal → kalimat tetap.
describe("fixedText", () => {
  const MAP = { quota: "Jatah habis.", busy: "Sibuk." } as const;
  it("kode dikenal → kalimat tetap; kode lain, teks bebas, dan nama properti bawaan objek → undefined", () => {
    expect(fixedText(MAP, "quota")).toBe("Jatah habis.");
    for (const k of ["<script>x</script>", "Transfer ke rekening 123", "__proto__", "constructor", "toString", "hasOwnProperty", "", undefined, null, ["quota"]]) {
      expect(fixedText(MAP, k)).toBeUndefined();
    }
  });
});

describe("isUuid / maskEmail", () => {
  it("hanya UUID yang lolos; email ditampilkan tersamar dan hanya bila berbentuk email", () => {
    expect(isUuid("3f1c2a7e-1b2c-4d5e-8f90-1234567890ab")).toBe(true);
    for (const k of ["../../logout", "abc", undefined, "3f1c2a7e-1b2c-4d5e-8f90-1234567890ab/x"]) expect(isUuid(k)).toBe(false);
    expect(maskEmail("sinta.dewi@example.test")).toBe("si***@example.test");
    expect(maskEmail("a@b.co")).toBe("a***@b.co");
    for (const k of ["Transfer sekarang ke 123", "<b>x</b>@y", undefined, "x@y"]) expect(maskEmail(k)).toBeNull();
  });
});

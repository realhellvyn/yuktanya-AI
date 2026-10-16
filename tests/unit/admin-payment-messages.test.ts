import { describe, expect, it } from "vitest";
import { BillingError } from "@/lib/billing/service";
import { adminPaymentErrorCode, adminPaymentErrorText, adminPaymentResultText } from "@/lib/billing/admin-messages";

// Bawaan Task 11: halaman admin pembayaran memetakan semua kode ke kalimat biasa; tidak pernah menggemakan kode mentah.
describe("pesan admin pembayaran", () => {
  it("INVALID, FORBIDDEN, NOT_FOUND, dan balapan unik punya kalimat sendiri; kode lain → kalimat umum tanpa kode", () => {
    for (const c of ["INVALID", "FORBIDDEN", "NOT_FOUND", "RACE", "DISCOUNT_TAKEN"]) {
      const t = adminPaymentErrorText(c)!;
      expect(t).toBeTruthy();
      expect(t).not.toContain(c);
    }
    expect(adminPaymentErrorText("INVALID")).not.toBe(adminPaymentErrorText("FORBIDDEN"));
    const unknown = adminPaymentErrorText("<script>x</script>")!;
    expect(unknown).not.toContain("script");
    expect(adminPaymentErrorText(undefined)).toBeNull();
    expect(adminPaymentResultText("SETTLED")).toContain("dikonfirmasi");
    expect(adminPaymentResultText("Transfer ke 123")).toBeNull();
  });
  it("galat dari layanan dipetakan ke kode: BillingError, pelanggaran unik Postgres (23505), INVALID_RECEIVED_AT; lainnya null", () => {
    expect(adminPaymentErrorCode(new BillingError("FORBIDDEN"))).toBe("FORBIDDEN");
    expect(adminPaymentErrorCode(Object.assign(new Error("duplicate key value"), { code: "23505" }))).toBe("RACE");
    expect(adminPaymentErrorCode(new Error("INVALID_RECEIVED_AT"))).toBe("INVALID");
    expect(adminPaymentErrorCode(new Error("lain"))).toBeNull();
  });
});

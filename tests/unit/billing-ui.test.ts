import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OrderStatus } from "@/components/billing/order-status";
import { PriceBreakdown } from "@/components/billing/price-breakdown";
import { CHECKOUT_NOTE } from "@/lib/copy";

describe("PriceBreakdown", () => {
  it("memuat harga, aturan Member pertama/berikutnya, pernyataan pembayaran, tanpa 'cap'", () => {
    for (const [amount, variant, text] of [[50000, "FREE", "Rp50.000"], [30000, "MEMBER_FIRST", "Rp30.000"], [35000, "MEMBER_LATER", "Rp35.000"]] as const) {
      const h = renderToStaticMarkup(PriceBreakdown({ service: "Pemeriksaan Standar", quote: { amountIdr: amount, variant, usesCredit: false } }));
      expect(h).toContain(text);
      expect(h).toContain(CHECKOUT_NOTE);
      expect(h).toContain("pemeriksaan pertama pada setiap periode tagihan");
      expect(h).not.toMatch(/semua Rp30\.000|\bcap\b/i);
    }
  });
  it("kredit menampilkan Rp0 dan keterangan kredit", () => {
    const h = renderToStaticMarkup(PriceBreakdown({ service: "x", quote: { amountIdr: 0, variant: "CREDIT", usesCredit: true } }));
    expect(h).toContain("Rp0");
    expect(h).toContain("kredit");
  });
});

describe("OrderStatus", () => {
  const base = { amountIdr: 30000, expiresAt: "2026-10-17T05:00:00.000Z" };
  it("status berupa teks", () => {
    expect(renderToStaticMarkup(OrderStatus({ order: { ...base, status: "PENDING_PAYMENT" } }))).toContain("Menunggu pembayaran");
    expect(renderToStaticMarkup(OrderStatus({ order: { ...base, status: "PAID" } }))).toContain("Pembayaran dikonfirmasi");
    expect(renderToStaticMarkup(OrderStatus({ order: { ...base, status: "EXPIRED" } }))).toContain("Kedaluwarsa");
    expect(renderToStaticMarkup(OrderStatus({ order: { ...base, status: "RECONCILIATION_REQUIRED" } }))).toContain("sudah kami terima");
  });
});

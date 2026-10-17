import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReviewRequestCard } from "@/components/reviews/review-request-card";

// Task 23 (A06): kartu Legal Review di halaman dokumen. Versi yang sudah punya pesanan aktif tidak ditawari harga lagi.
const noop = async () => {};
const ORDER = "11111111-1111-4111-8111-111111111111";
const REQ = "22222222-2222-4222-8222-222222222222";
const VERSION = "33333333-3333-4333-8333-333333333333";
const render = (over: Partial<Parameters<typeof ReviewRequestCard>[0]> = {}) =>
  renderToStaticMarkup(ReviewRequestCard({ versionId: VERSION, active: null, quote: { amountIdr: 50000 }, action: noop, ...over }));

describe("ReviewRequestCard", () => {
  it("belum ada pesanan: harga dan tombol 'Ajukan Legal Review' untuk versi ini", () => {
    const h = render();
    expect(h).toContain("Ajukan Legal Review");
    expect(h).toContain("Rp50.000");
    expect(h).toContain(`value="${VERSION}"`);
  });

  it("menunggu pembayaran: 'Lanjutkan pembayaran' ke checkout pesanan itu; harga dan tombol ajukan tidak tampil", () => {
    const h = render({ active: { orderId: ORDER, status: "PENDING_PAYMENT", requestId: null } });
    expect(h).toContain("Lanjutkan pembayaran");
    expect(h).toContain(`href="/checkout/${ORDER}"`);
    expect(h).toContain("menunggu pembayaran");
    expect(h).not.toContain("Ajukan Legal Review");
    expect(h).not.toContain("Rp50.000");
    expect(h).not.toContain("<form");
  });

  it("sudah dibayar: 'Lihat Legal Review' ke halaman pemeriksaan terkait; harga tidak tampil", () => {
    const h = render({ active: { orderId: ORDER, status: "PAID", requestId: REQ } });
    expect(h).toContain("Lihat Legal Review");
    expect(h).toContain(`href="/reviews/${REQ}"`);
    expect(h).not.toContain("Ajukan Legal Review");
    expect(h).not.toContain("Rp50.000");
  });

  it("sudah dibayar tanpa id pemeriksaan: tautan ke daftar Legal Review", () => {
    expect(render({ active: { orderId: ORDER, status: "PAID", requestId: null } })).toContain('href="/reviews"');
  });

  it("tanpa pesanan dan tanpa harga (mis. pratinjau ditolak): tidak menampilkan apa pun", () => {
    expect(render({ quote: null })).toBe("");
  });

  it("teks tanpa em dash", () => {
    for (const active of [null, { orderId: ORDER, status: "PENDING_PAYMENT" as const, requestId: null }, { orderId: ORDER, status: "PAID" as const, requestId: REQ }]) {
      expect(render({ active })).not.toContain("—");
    }
  });
});

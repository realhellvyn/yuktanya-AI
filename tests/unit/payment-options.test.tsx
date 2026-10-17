import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PaymentOptions } from "@/components/billing/payment-options";

const noop = async () => {};
const base = { orderId: "11111111-1111-4111-8111-111111111111", midtransAvailable: true, production: true, manualText: null, payAction: noop, refreshAction: noop, mockSettleAction: noop };
const render = (over: Partial<Parameters<typeof PaymentOptions>[0]> = {}) => renderToStaticMarkup(PaymentOptions({ ...base, payments: [], ...over }));
const P = (provider: string, status: string, id = "22222222-2222-4222-8222-222222222222") => ({ id, provider, status });

describe("PaymentOptions (checkout, Task 21)", () => {
  it("Midtrans tersedia: satu tombol 'Bayar dengan Midtrans'; tidak ada opsi transfer bank untuk pengguna", () => {
    const h = render();
    expect(h).toContain("Bayar dengan Midtrans");
    expect(h).toContain('name="provider" value="midtrans"');
    expect(h).toContain("tidak menyimpan data kartu");
    expect(h).not.toMatch(/Bayar dengan transfer bank|value="manual"|pesanan lama/i);
    expect(h).not.toContain("Perbarui status");
  });

  it("tanpa server key: 'Pembayaran belum tersedia' (informasi, bukan galat) dan tanpa tombol bayar", () => {
    const h = render({ midtransAvailable: false });
    expect(h).toContain("Pembayaran belum tersedia");
    expect(h).not.toContain("Bayar dengan Midtrans");
    expect(h).not.toContain('role="alert"');
  });

  it("pembayaran Midtrans PENDING: lanjutkan pembayaran + 'Perbarui status'; status hanya dari konfirmasi Midtrans", () => {
    const h = render({ payments: [P("midtrans", "PENDING")] });
    expect(h).toContain("Lanjutkan pembayaran di Midtrans");
    expect(h).toContain("Perbarui status");
    expect(h).toContain("setelah Midtrans mengonfirmasi");
    expect(h).not.toContain("Bayar dengan Midtrans");
  });

  it("pembayaran sebelumnya gagal/kedaluwarsa: dapat membayar ulang", () => {
    for (const s of ["FAILED", "EXPIRED"]) {
      const h = render({ payments: [P("midtrans", s)] });
      expect(h, s).toContain("Bayar dengan Midtrans");
      expect(h, s).toContain("Pembayaran sebelumnya");
    }
  });

  it("transfer manual lama yang masih menunggu tetap menampilkan instruksi dan kode referensi", () => {
    const h = render({ payments: [P("manual", "PENDING")], manualText: "Transfer ke rekening uji" });
    expect(h).toContain("Transfer ke rekening uji");
    expect(h).toContain("Tulis kode berikut");
  });

  it("produksi tanpa tombol simulasi; non-produksi menampilkan simulasi", () => {
    expect(render()).not.toContain("simulasi");
    expect(render({ production: false })).toContain("Pembayaran simulasi (hanya uji)");
    expect(render({ production: false, payments: [P("mock", "PENDING")] })).toContain("Simulasikan pembayaran berhasil");
  });

  it("halaman checkout tidak membaca status bayar dari parameter URL (order_id/status_code/transaction_status Midtrans)", () => {
    const src = readFileSync("src/app/(app)/checkout/[orderId]/page.tsx", "utf8");
    expect(src).not.toMatch(/transaction_status|status_code|searchParams[^;]*order_id/);
    expect(src).toContain("PaymentOptions");
    expect(src).not.toMatch(/Bayar dengan transfer bank/);
  });
});

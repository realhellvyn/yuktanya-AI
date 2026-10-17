import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PricingPage from "@/app/(public)/pricing/page";

const html = () => renderToStaticMarkup(PricingPage());

describe("/pricing", () => {
  it("memuat semua harga terkunci v8", () => {
    for (const price of ["Rp19.000", "Rp50.000", "Rp30.000", "Rp35.000", "Rp200.000", "Rp150.000"]) {
      expect(html()).toContain(price);
    }
  });

  it("memuat kalimat kasus khusus dan pernyataan pembayaran", () => {
    expect(html()).toContain("Biaya dan ruang lingkup ditentukan setelah asesmen profesional.");
    expect(html()).toContain("Pembayaran adalah biaya pemeriksaan.");
  });

  it("tidak menyediakan tombol beli Deep mandiri", () => {
    expect(html()).not.toMatch(/<button/i);
    expect(html()).not.toMatch(/Beli (pemeriksaan mendalam|Deep Review)/i);
  });
});

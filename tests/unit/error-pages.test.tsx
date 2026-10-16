import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import NotFound from "@/app/not-found";
import ErrorPage from "@/app/error";
import GlobalError from "@/app/global-error";
import Loading from "@/app/(app)/dashboard/loading";

// D-09: halaman galat, 404, dan memuat dalam Bahasa Indonesia sederhana, tanpa jejak tumpukan, dengan jalan kembali.
describe("halaman galat dan memuat", () => {
  const err = Object.assign(new Error("ECONNREFUSED 10.0.0.5:5432 di /srv/app/lib/db.ts:42"), { digest: "abc123" });

  it("404: judul Indonesia, tautan ke Beranda dan Bantuan", () => {
    const h = renderToStaticMarkup(createElement(NotFound));
    expect(h).toContain("Halaman tidak ditemukan");
    expect(h).toContain('href="/"');
    expect(h).toContain('href="/bantuan"');
    expect(h).not.toMatch(/not found|404 \|/i);
  });

  it("galat: tombol Coba lagi, tautan ke Beranda, tanpa pesan atau jejak galat", () => {
    for (const C of [ErrorPage, GlobalError]) {
      const h = renderToStaticMarkup(createElement(C, { error: err, reset: () => {} }));
      expect(h).toContain("Coba lagi");
      expect(h).toContain('href="/"');
      expect(h).toContain("Terjadi kendala");
      expect(h).not.toContain("ECONNREFUSED");
      expect(h).not.toContain("db.ts");
    }
    expect(renderToStaticMarkup(createElement(GlobalError, { error: err, reset: () => {} }))).toContain('lang="id"');
  });

  it("memuat: status teks yang dibacakan pembaca layar", () => {
    const h = renderToStaticMarkup(createElement(Loading));
    expect(h).toContain('role="status"');
    expect(h).toContain("Memuat");
  });
});

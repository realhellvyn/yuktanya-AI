import { describe, expect, it } from "vitest";
import { parseAttribution } from "@/lib/auth/attribution";

describe("parseAttribution", () => {
  it("hanya mengambil tiga kunci utm", () => {
    const q = new URLSearchParams("utm_source=meta&utm_campaign=c1&utm_creative=v2&x=1&utm_medium=cpc");
    expect(parseAttribution(q)).toEqual({ utm_source: "meta", utm_campaign: "c1", utm_creative: "v2" });
  });

  it("memangkas nilai 300 karakter menjadi 100", () => {
    const q = new URLSearchParams({ utm_source: "a".repeat(300) });
    expect(parseAttribution(q).utm_source).toHaveLength(100);
  });

  it("mengabaikan nilai kosong dan tidak mengembalikan kunci lain", () => {
    expect(parseAttribution(new URLSearchParams("utm_source=&foo=bar"))).toEqual({});
  });
});

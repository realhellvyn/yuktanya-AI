import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Task 18: token brand kit (navy · gold · cream, tema terang) di src/app/globals.css. Tes ini membaca nilai token
// langsung dari CSS sehingga perubahan warna yang menurunkan kontras di bawah WCAG AA langsung gagal.
const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const css = read("src/app/globals.css");

function rootTokens(source: string): Record<string, string> {
  const block = /:root\s*\{([^}]*)\}/.exec(source)?.[1] ?? "";
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1]] = m[2].toUpperCase();
  return out;
}
const T = rootTokens(css);
const tok = (name: string) => {
  expect(T[name], `token --${name} tidak ada di :root globals.css`).toMatch(/^#[0-9A-F]{6}$/);
  return T[name];
};

// WCAG 2.x: luminans relatif dan rasio kontras.
type Rgb = [number, number, number]; // linear sRGB 0..1
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const hexRgb = (hex: string): Rgb => [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255)) as Rgb;
// Warna status Tailwind v4 ditulis dalam oklch; dikonversi ke linear sRGB (Björn Ottosson) lalu dipotong ke gamut.
function oklchRgb(l: number, c: number, hDeg: number): Rgb {
  const h = (hDeg * Math.PI) / 180, a = c * Math.cos(h), b = c * Math.sin(h);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return [
    clamp(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
    clamp(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
    clamp(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_),
  ];
}
const lum = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const ratio = (x: Rgb, y: Rgb) => {
  const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
};
const contrast = (fg: string, bg: string) => ratio(hexRgb(tok(fg)), hexRgb(tok(bg)));

const twTheme = read("node_modules/tailwindcss/theme.css");
const tw = (name: string): Rgb => {
  const m = new RegExp(`--color-${name}:\\s*oklch\\(([\\d.]+)%\\s+([\\d.]+)\\s+([\\d.]+)\\)`).exec(twTheme);
  expect(m, `warna Tailwind ${name} tidak ditemukan`).not.toBeNull();
  return oklchRgb(Number(m![1]) / 100, Number(m![2]), Number(m![3]));
};

describe("token brand kit di globals.css", () => {
  it("nilai identitas dan peran sesuai brand kit (tema terang)", () => {
    expect({ navy: tok("navy"), gold: tok("gold"), cream: tok("cream"), charcoal: tok("charcoal") }).toEqual({ navy: "#0D1B2A", gold: "#D4A66A", cream: "#F8F5EC", charcoal: "#1A1A1A" });
    expect(tok("bg")).toBe(tok("cream"));
    expect(tok("surface")).toBe("#FFFFFF");
    expect(tok("ink")).toBe(tok("charcoal"));
    expect(tok("heading")).toBe(tok("navy"));
    expect(tok("primary")).toBe(tok("navy"));
    expect(tok("on-primary")).toBe("#FFFFFF");
    expect(tok("link")).toBe(tok("navy"));
    expect(tok("muted")).toBe("#5B5A55");
    expect(tok("gold-ink")).toBe("#8A6420");
    expect(tok("focus")).toBe(tok("gold-ink"));
    expect(tok("line")).toBe("#E4DDCD");
    expect(tok("border-strong")).toBe("#7A7468");
    expect(tok("success")).toBe("#166534");
    expect(tok("danger")).toBe("#B91C1C");
  });

  it("hanya tema terang: tidak ada blok tema gelap", () => {
    expect(css).not.toMatch(/prefers-color-scheme\s*:\s*dark|data-theme/);
  });

  it("setiap token peran dipetakan ke utilitas Tailwind lewat @theme", () => {
    for (const [cls, v] of [["canvas", "bg"], ["surface", "surface"], ["ink", "ink"], ["heading", "heading"], ["muted", "muted"], ["primary", "primary"], ["primary-hover", "primary-hover"], ["on-primary", "on-primary"], ["link", "link"], ["line", "line"], ["border-strong", "border-strong"], ["focus", "focus"], ["gold-ink", "gold-ink"], ["tint", "tint"], ["subtle", "subtle"], ["navy", "navy"], ["success", "success"], ["danger", "danger"]]) {
      expect(css, `--color-${cls}`).toMatch(new RegExp(`--color-${cls}:\\s*var\\(--${v}\\);`));
    }
  });

  // Tabel kontras yang sama dicatat di laporan Task 18 / docs/DESIGN_SYSTEM.md.
  const TEXT_PAIRS: [string, string][] = [
    ["ink", "bg"], ["ink", "surface"], ["ink", "tint"], ["ink", "subtle"],
    ["heading", "bg"], ["heading", "surface"], ["heading", "tint"],
    ["muted", "bg"], ["muted", "surface"], ["muted", "tint"], ["muted", "subtle"],
    ["on-primary", "primary"], ["on-primary", "primary-hover"],
    ["link", "bg"], ["link", "surface"], ["link", "tint"],
    ["gold-ink", "bg"], ["gold-ink", "surface"],
    ["danger", "bg"], ["danger", "surface"], ["success", "bg"], ["success", "surface"],
  ];
  it.each(TEXT_PAIRS)("teks %s di atas %s ≥ 4,5:1", (fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  const UI_PAIRS: [string, string][] = [
    ["border-strong", "bg"], ["border-strong", "surface"], ["focus", "bg"], ["focus", "surface"], ["focus", "tint"],
    ["success", "surface"], // lingkaran lencana verifikasi vs centang putih
  ];
  it.each(UI_PAIRS)("komponen UI %s di atas %s ≥ 3:1", (fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(3);
  });

  it("gold aman di atas navy, tetapi gagal di latar terang (alasan larangan)", () => {
    expect(contrast("gold", "navy")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("gold", "bg")).toBeLessThan(3);
    expect(contrast("gold", "surface")).toBeLessThan(3);
  });

  it("warna peringatan/status Tailwind tetap ≥ 4,5:1 di atas cream dan di atas latar kotaknya", () => {
    const cream = hexRgb(tok("bg"));
    for (const [fg, box] of [["amber-900", "amber-50"], ["amber-950", "amber-50"], ["green-900", "green-50"], ["red-800", "red-50"], ["red-900", "red-50"]]) {
      expect(ratio(tw(fg), cream), `${fg} di atas cream`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(tw(fg), tw(box)), `${fg} di atas ${box}`).toBeGreaterThanOrEqual(4.5);
    }
    for (const box of ["amber-50", "green-50", "red-50"]) {
      expect(ratio(hexRgb(tok("ink")), tw(box)), `ink di atas ${box}`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(hexRgb(tok("muted")), tw(box)), `muted di atas ${box}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(ratio(hexRgb(tok("danger")), tw("red-50"))).toBeGreaterThanOrEqual(4.5);
  });
});

// --- Aturan pemakaian kelas di src/** ---
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}
const SRC = sourceFiles(join(ROOT, "src"));
const literals = (code: string) => [...code.matchAll(/"([^"\n]*)"|'([^'\n]*)'|`([^`]*)`/g)].map((m) => m[1] ?? m[2] ?? m[3]);

// Kelas warna gold (bukan gold-ink), dengan atau tanpa varian (hover:, md:, ...) dan opasitas.
const GOLD_CLASS = /(?<![\w-])(?:[a-z0-9-]+:)*(?:text|bg|fill|stroke|border|ring|outline|decoration|from|via|to|divide|placeholder|caret|accent|shadow)-gold(?:\/\d+)?(?![\w-])/;
// Aturan yang diuji: string kelas yang memuat kelas gold wajib memuat bg-navy pada string yang sama (elemen itu sendiri
// berlatar navy). Gold di latar terang hanya 2:1, jadi tidak boleh untuk teks, ikon bermakna, atau isi tombol.
const goldViolations = (code: string) => literals(code).filter((s) => GOLD_CLASS.test(s) && !/(?<![\w-])bg-navy(?![\w-])/.test(s));

describe("aturan gold dan palet hangat di src/**", () => {
  it("pendeteksi aturan gold bekerja", () => {
    expect(goldViolations(`<p className="text-gold">x</p>`)).toHaveLength(1);
    expect(goldViolations(`<b className="bg-gold text-navy">x</b>`)).toHaveLength(1);
    expect(goldViolations(`cn("hover:text-gold/80 font-bold")`)).toHaveLength(1);
    expect(goldViolations(`<span className="bg-navy text-gold">1</span>`)).toHaveLength(0);
    expect(goldViolations(`<a className="text-gold-ink underline">x</a>`)).toHaveLength(0);
  });

  it("kelas gold hanya dipakai pada elemen ber-bg-navy", () => {
    const offenders = SRC.flatMap((f) => goldViolations(readFileSync(f, "utf8")).map((s) => `${f.slice(ROOT.length + 1)}: "${s}"`));
    expect(offenders).toEqual([]);
  });

  it("nilai gold mentah (#D4A66A / var(--gold)) tidak dipakai di kode komponen", () => {
    const offenders = SRC.filter((f) => /#d4a66a|var\(--gold\)|var\(--color-gold\)/i.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("tidak ada kelas abu kebiruan/biru Tailwind atau token lama brand di src", () => {
    const COOL = /(?<![\w-])(?:[a-z0-9-]+:)*(?:bg|text|border|ring|from|via|to|divide|fill|stroke|outline|decoration|placeholder|shadow)-(?:slate|gray|zinc|neutral|blue|sky|indigo)-\d{2,3}(?![\w-])|(?<![\w-])(?:[a-z0-9-]+:)*(?:bg|text|border|ring)-brand(?:-dark)?(?![\w-])|--color-brand/;
    const offenders = SRC.flatMap((f) => readFileSync(f, "utf8").split("\n").map((l, i) => [l, i] as const).filter(([l]) => COOL.test(l)).map(([, i]) => `${f.slice(ROOT.length + 1)}:${i + 1}`));
    expect(offenders).toEqual([]);
  });
});

describe("font dan logo", () => {
  it("font lokal: Plus Jakarta Sans untuk teks, Source Serif 4 hanya untuk wordmark, tanpa Google Fonts", () => {
    expect(css).toMatch(/--font-sans:\s*"Plus Jakarta Sans Variable"/);
    expect(css).toMatch(/--font-serif:\s*"Source Serif 4"/);
    const layout = read("src/app/layout.tsx");
    expect(layout).toContain('import "@fontsource-variable/plus-jakarta-sans/wght.css"');
    expect(layout).toContain('import "@fontsource/source-serif-4/latin-700.css"');
    const all = [...SRC.map((f) => readFileSync(f, "utf8")), css, read("next.config.ts")].join("\n");
    expect(all).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com|next\/font\/google/);
    const serifUsers = SRC.filter((f) => /(?<![\w-])font-serif(?![\w-])/.test(readFileSync(f, "utf8"))).map((f) => f.slice(ROOT.length + 1));
    expect(serifUsers).toEqual(["src/components/brand-logo.tsx"]);
  });

  it("logo SVG brand kit tersedia di public/brand dan ikon aplikasi sama dengan app-icon", () => {
    for (const n of ["app-icon", "mark-navy", "mark-gold", "mark-white", "mark-small-navy", "mark-small-gold"]) {
      expect(existsSync(join(ROOT, `public/brand/yuktanya-${n}.svg`)), n).toBe(true);
    }
    expect(read("src/app/icon.svg")).toBe(read("public/brand/yuktanya-app-icon.svg"));
  });
});

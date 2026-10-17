// Membuat src/app/apple-icon.png (180×180) dan src/app/opengraph-image.png (1200×630) dari SVG brand kit di public/brand
// dan font lokal @fontsource. Dijalankan SEKALI bila logo/warna brand berubah; hasil PNG di-commit (tidak dijalankan saat build).
// Pakai: node scripts/brand/render-icons.mjs   (butuh Chromium Playwright; CHROMIUM=... untuk jalur eksplisit)
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const { chromium } = (() => { try { return require("playwright"); } catch { return require("/opt/node22/lib/node_modules/playwright"); } })();

const NAVY = "#0D1B2A", GOLD = "#D4A66A", CREAM = "#F8F5EC";
const svg = (name) => readFileSync(path.join(ROOT, "public/brand", name), "utf8");
const font = (rel) => readFileSync(path.join(ROOT, "node_modules", rel)).toString("base64");
const FONTS = `
@font-face { font-family: "Plus Jakarta Sans"; font-weight: 200 800; src: url(data:font/woff2;base64,${font("@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2")}) format("woff2"); }
@font-face { font-family: "Source Serif 4"; font-weight: 700; src: url(data:font/woff2;base64,${font("@fontsource/source-serif-4/files/source-serif-4-latin-700-normal.woff2")}) format("woff2"); }`;

const page = (body, css) => `<!doctype html><html><head><meta charset="utf-8"><style>${FONTS}
html,body{margin:0;padding:0;background:${NAVY};} ${css}</style></head><body>${body}</body></html>`;

// iOS memberi sudut membulat sendiri: latar navy penuh sampai tepi, mark sama dengan ikon aplikasi.
const apple = page(svg("yuktanya-app-icon.svg"), "svg{display:block;width:180px;height:180px}");

const og = page(`
<div class="wrap">
  <div class="mark">${svg("yuktanya-mark-gold.svg")}</div>
  <div class="text">
    <div class="wm">Yuktanya</div>
    <div class="rule"></div>
    <div class="tag">Legal Service Seharga Secangkir Kopi.</div>
  </div>
</div>`, `
.wrap{width:1200px;height:630px;box-sizing:border-box;display:flex;align-items:center;gap:72px;padding:0 112px}
.mark svg{display:block;height:300px;width:auto}
.text{display:flex;flex-direction:column}
.wm{font:700 128px/1 "Source Serif 4",serif;color:${CREAM};letter-spacing:-0.5px}
.rule{width:96px;height:4px;background:${GOLD};border-radius:2px;margin:36px 0 30px}
.tag{font:600 40px/1.25 "Plus Jakarta Sans",sans-serif;color:${CREAM};max-width:620px}`);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? undefined });
try {
  for (const [html, w, h, out] of [[apple, 180, 180, "src/app/apple-icon.png"], [og, 1200, 630, "src/app/opengraph-image.png"]]) {
    const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    await p.setContent(html, { waitUntil: "load" });
    await p.evaluate(() => document.fonts.ready);
    const loaded = await p.evaluate(() => [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family));
    if (out.includes("opengraph") && !(loaded.includes("Source Serif 4") && loaded.includes("Plus Jakarta Sans"))) throw new Error("font belum termuat: " + loaded);
    await p.screenshot({ path: path.join(ROOT, out), clip: { x: 0, y: 0, width: w, height: h } });
    await p.close();
    console.log("ditulis", out);
  }
} finally {
  await browser.close();
}

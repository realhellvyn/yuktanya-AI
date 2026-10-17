// E2E browser lokal: Postgres sementara + Supabase Auth palsu + next dev + Chromium. Dijalankan lewat scripts/e2e/run.sh.
// E2E_PROD=1: `next build` lalu `next start` (React produksi, kode termampatkan, CSP produksi bernonce) dengan env yang sama.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { SERVICE_KEY, startFakeLlm, startFakeSupabase } from "./fake-supabase.mjs";
import { MIDTRANS_TEST_KEY, startFakeMidtrans } from "./fake-midtrans.mjs";

const require = createRequire(import.meta.url);
// Urutan: PLAYWRIGHT_MODULE (jalur eksplisit) -> paket `playwright` di node_modules repo -> jalur global sandbox.
const loadPlaywright = () => {
  if (process.env.PLAYWRIGHT_MODULE) return require(process.env.PLAYWRIGHT_MODULE);
  try { return require("playwright"); } catch { return require("/opt/node22/lib/node_modules/playwright"); }
};
const { chromium } = loadPlaywright();
const { Pool } = require("pg");
const APP = 3100, FAKE = 54999;
const SHOTS = process.env.SHOTS_DIR ?? path.join(tmpdir(), "yk-shots");
mkdirSync(SHOTS, { recursive: true });
const results = [];
const step = async (name, fn) => {
  try { await fn(); results.push(["PASS", name]); console.log("PASS", name); }
  catch (e) { results.push(["FAIL", name, String(e.message).slice(0, 9000)]); console.log("FAIL", name, "-", String(e.message).slice(0, 9000)); }
};

try { await fetch(`http://localhost:${APP}/`); console.error(`Port ${APP} sudah dipakai proses lain; hentikan dulu.`); process.exit(2); } catch {}
const fake = await startFakeSupabase({ databaseUrl: process.env.TEST_DATABASE_URL, port: FAKE });
const llm = await startFakeLlm({ port: 54998 });
// Midtrans palsu (Task 21): Snap, halaman bayar simulasi yang mengirim webhook bertanda tangan, dan Get Status API.
const midtrans = await startFakeMidtrans({ port: 54997, appBase: `http://localhost:${APP}` });
const env = {
  ...process.env, PORT: String(APP),
  NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${FAKE}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  DATABASE_URL: process.env.TEST_DATABASE_URL, AI_MOCK_MODE: "false", FREELLM_BASE_URL: "http://127.0.0.1:54998", FREELLM_API_KEY: "uji", ALLOW_UNAPPROVED_TEMPLATES: "true",
  NEXT_PUBLIC_APP_URL: `http://localhost:${APP}`, DOCUMENT_BLOB_DIR: mkdtempSync(path.join(tmpdir(), "yk-blob-")),
  MANUAL_PAYMENT_INSTRUCTIONS: "Transfer ke rekening uji 000-000", NEXT_TELEMETRY_DISABLED: "1",
  // MIDTRANS_TEST_BASE_URL hanya diterima untuk alamat loopback (src/lib/billing/midtrans.ts), juga di build produksi.
  MIDTRANS_SERVER_KEY: MIDTRANS_TEST_KEY, MIDTRANS_ENV: "sandbox", MIDTRANS_TEST_BASE_URL: midtrans.origin,
  // Ketiga flag fitur menyala di dev DAN produksi harness, sama dengan produksi sejak 17 Okt 2026 (keputusan pemilik).
  DEEP_REVIEW_PURCHASE: "true", ENHANCED_ISSUANCE: "true", AI_PREREVIEW_ENABLED: "true",
};
const PROD = process.env.E2E_PROD === "1";
// Produksi menolak NEXT_PUBLIC_APP_URL non-https (src/lib/app-url.ts); URL ini hanya untuk tautan email/QR, bukan untuk navigasi uji.
if (PROD) env.NEXT_PUBLIC_APP_URL = `https://localhost:${APP}`;
if (PROD) {
  console.log(`E2E_PROD=1: next build (mode produksi), flag AI_PREREVIEW_ENABLED=${env.AI_PREREVIEW_ENABLED} DEEP_REVIEW_PURCHASE=${env.DEEP_REVIEW_PURCHASE} ENHANCED_ISSUANCE=${env.ENHANCED_ISSUANCE}…`);
  // `next build` menulis ulang next-env.d.ts ke tipe produksi; isi yang tercatat di git dikembalikan setelahnya.
  const nextEnv = existsSync("next-env.d.ts") ? readFileSync("next-env.d.ts", "utf8") : null;
  const b = spawnSync("npx", ["next", "build"], { env: { ...env, NODE_ENV: "production" }, stdio: "inherit" });
  if (nextEnv !== null) writeFileSync("next-env.d.ts", nextEnv);
  if (b.status !== 0) { llm.close(); await midtrans.close(); await fake.close(); console.error("next build gagal"); process.exit(1); }
}
const db = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 2 });
if (PROD) {
  // Produksi selalu mewajibkan template APPROVED dengan hash yang sama (ALLOW_UNAPPROVED_TEMPLATES diabaikan). Hanya di DB uji
  // sementara: hash dari scripts/templates/print-hashes.mjs dicatat APPROVED agar alur dokumen dapat diuji seperti produksi.
  const out = spawnSync("node", ["scripts/templates/print-hashes.mjs"], { encoding: "utf8" });
  if (out.status !== 0) throw new Error("print-hashes gagal: " + out.stderr);
  for (const line of out.stdout.trim().split("\n")) {
    const [, id, version, hash] = line.split("\t");
    await db.query("insert into document_templates (template_id, version, content_hash, approval_status, approved_at) values ($1, $2, $3, 'APPROVED', now()) on conflict do nothing", [id, Number(version), hash]);
  }
}
const dev = spawn("npx", PROD ? ["next", "start", "-p", String(APP)] : ["next", "dev", "-p", String(APP)], { env: PROD ? { ...env, NODE_ENV: "production" } : env, stdio: ["ignore", "pipe", "pipe"], detached: true });
let devLog = "";
dev.stdout.on("data", (d) => (devLog += d)); dev.stderr.on("data", (d) => (devLog += d));
const stop = async () => { try { process.kill(-dev.pid, "SIGKILL"); } catch {} llm.close(); await midtrans.close(); await db.end(); await fake.close(); };

try {
  for (let i = 0; i < 90; i++) { try { const r = await fetch(`http://localhost:${APP}/login`); if (r.ok) break; } catch {} await new Promise((r) => setTimeout(r, 1000)); }
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? undefined });
  const viewports = JSON.parse(process.env.VIEWPORTS ?? '[{"name":"desktop","width":1280,"height":800}]');
  const files = (process.env.JOURNEY ?? "./journey.mjs,./journey-roles.mjs,./journey-public.mjs,./journey-ui-roles.mjs,./journey-cases.mjs,./journey-ai-review.mjs,./journey-admin-analytics.mjs,./journey-data-rights.mjs,./journey-ux.mjs,./journey-prod-ai.mjs,./journey-midtrans.mjs").split(",");
  for (const file of files) {
    const mod = await import(file);
    for (const vp of viewports.filter((v) => !mod.onlyViewport || v.name === mod.onlyViewport)) {
      const opened = [];
      // Setiap aktor (pemilik, admin, koordinator, reviewer) punya konteks browser sendiri = sesi terpisah.
      const newActor = async (name) => {
        const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, acceptDownloads: true });
        opened.push(ctx);
        // Chrome terbaru (149/150+): scrollIntoView/scrollTo/scrollBy/scroll MENGEMBALIKAN Promise. Chromium Playwright yang
        // terpasang (141) masih mengembalikan undefined, jadi perilaku baru ditiru di setiap konteks agar uji melihat browser
        // pengguna nyata (Task 17: efek `() => el.scrollIntoView()` membuat React memanggil Promise sebagai cleanup).
        if (process.env.E2E_SCROLL_PROMISE !== "0") {
          await ctx.addInitScript(() => {
            const wrap = (obj, name) => {
              const orig = obj[name];
              if (typeof orig !== "function") return;
              obj[name] = function (...args) {
                const r = orig.apply(this, args);
                return r instanceof Promise ? r : Promise.resolve(true);
              };
            };
            for (const n of ["scrollIntoView", "scroll", "scrollTo", "scrollBy"]) wrap(Element.prototype, n);
            for (const n of ["scroll", "scrollTo", "scrollBy"]) wrap(window, n);
          });
        }
        const page = await ctx.newPage();
        const issues = [];
        page.on("console", (m) => { if (m.type() === "error") issues.push(`${m.text()}`.slice(0, 9000)); });
        page.on("pageerror", (e) => issues.push(`pageerror: ${e.message}`.slice(0, 9000)));
        const shot = (n) => page.screenshot({ path: path.join(SHOTS, `${vp.name}-${name}-${n}.png`), fullPage: true, caret: "initial" });
        return { page, shot, issues };
      };
      const main = await newActor("main");
      await mod.journey({ ...main, step, base: `http://localhost:${APP}`, vp, llm, db, newActor, fake, midtrans });
      for (const c of opened) await c.close();
    }
  }
  await browser.close();
} finally {
  await stop();
}
const failed = results.filter((r) => r[0] === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} lulus`);
if (failed.length) { console.log(devLog.split("\n").filter((l) => /error|Error/.test(l)).slice(-15).join("\n")); process.exit(1); }

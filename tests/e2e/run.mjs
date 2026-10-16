// E2E browser lokal: Postgres sementara + Supabase Auth palsu + next dev + Chromium. Dijalankan lewat scripts/e2e/run.sh.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { SERVICE_KEY, startFakeLlm, startFakeSupabase } from "./fake-supabase.mjs";

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
const env = {
  ...process.env, PORT: String(APP),
  NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${FAKE}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  DATABASE_URL: process.env.TEST_DATABASE_URL, AI_MOCK_MODE: "false", FREELLM_BASE_URL: "http://127.0.0.1:54998", FREELLM_API_KEY: "uji", ALLOW_UNAPPROVED_TEMPLATES: "true",
  NEXT_PUBLIC_APP_URL: `http://localhost:${APP}`, DOCUMENT_BLOB_DIR: mkdtempSync(path.join(tmpdir(), "yk-blob-")),
  MANUAL_PAYMENT_INSTRUCTIONS: "Transfer ke rekening uji 000-000", NEXT_TELEMETRY_DISABLED: "1",
  DEEP_REVIEW_PURCHASE: "true", ENHANCED_ISSUANCE: "true", AI_PREREVIEW_ENABLED: "true",
};
const db = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 2 });
const dev = spawn("npx", ["next", "dev", "-p", String(APP)], { env, stdio: ["ignore", "pipe", "pipe"], detached: true });
let devLog = "";
dev.stdout.on("data", (d) => (devLog += d)); dev.stderr.on("data", (d) => (devLog += d));
const stop = async () => { try { process.kill(-dev.pid, "SIGKILL"); } catch {} llm.close(); await db.end(); await fake.close(); };

try {
  for (let i = 0; i < 90; i++) { try { const r = await fetch(`http://localhost:${APP}/login`); if (r.ok) break; } catch {} await new Promise((r) => setTimeout(r, 1000)); }
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? undefined });
  const viewports = JSON.parse(process.env.VIEWPORTS ?? '[{"name":"desktop","width":1280,"height":800}]');
  const files = (process.env.JOURNEY ?? "./journey.mjs,./journey-roles.mjs,./journey-public.mjs,./journey-ui-roles.mjs,./journey-cases.mjs,./journey-ai-review.mjs,./journey-admin-analytics.mjs,./journey-data-rights.mjs").split(",");
  for (const file of files) {
    const mod = await import(file);
    for (const vp of viewports.filter((v) => !mod.onlyViewport || v.name === mod.onlyViewport)) {
      const opened = [];
      // Setiap aktor (pemilik, admin, koordinator, reviewer) punya konteks browser sendiri = sesi terpisah.
      const newActor = async (name) => {
        const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, acceptDownloads: true });
        opened.push(ctx);
        const page = await ctx.newPage();
        const issues = [];
        page.on("console", (m) => { if (m.type() === "error") issues.push(`${m.text()}`.slice(0, 9000)); });
        page.on("pageerror", (e) => issues.push(`pageerror: ${e.message}`.slice(0, 9000)));
        const shot = (n) => page.screenshot({ path: path.join(SHOTS, `${vp.name}-${name}-${n}.png`), fullPage: true, caret: "initial" });
        return { page, shot, issues };
      };
      const main = await newActor("main");
      await mod.journey({ ...main, step, base: `http://localhost:${APP}`, vp, llm, db, newActor, fake });
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

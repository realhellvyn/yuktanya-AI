// Perjalanan singkat untuk build produksi (Task 20, dipakai `npm run test:e2e:prod`; ketiga flag fitur menyala di env harness,
// sama seperti keputusan pemilik 17 Okt 2026 untuk produksi): unggah TXT sintetis → analisis awal AI (LLM palsu) → rekaman
// AI Verified terbit → laporan AI pemilik dan /verify rekaman itu tampil dengan medali bronze (tanpa kata Legal di medali) →
// tanpa pageerror, error konsol, atau halaman galat. Juga memastikan tombol unggah tampil di dasbor dan daftar dokumen.
import { register } from "./helpers.mjs";

export const onlyViewport = "desktop";
const TXT = "Perjanjian Sewa Gerobak (sintetis)\n\nPasal 1\nPihak Pertama menyewakan satu gerobak dagang kepada Pihak Kedua.\n\nPasal 2\nSewa Rp300.000 per bulan, dibayar setiap tanggal 5.";
const AI_TITLE = "Yuktanya AI Verified — Pemeriksaan Awal oleh AI";
const AI_STATEMENT = "Analisis otomatis untuk versi dokumen ini telah selesai. Bukan pengesahan hukum dan belum diperiksa pengacara.";

export async function journey({ page, step, shot, base, db, issues, newActor }) {
  const tag = (s) => `[prod-ai] ${s}`;
  const email = `prod-ai+${Date.now()}@example.com`;
  const clean = async (where) => {
    await page.waitForLoadState("networkidle");
    const body = await page.innerText("body");
    if (body.includes("Terjadi kendala")) throw new Error(`${where}: halaman galat`);
    if (issues.length) throw new Error(`${where}: error konsol/pageerror: ${issues.splice(0).join(" | ")}`);
    return body;
  };
  const medals = (p) => p.locator("main [data-medal]").evaluateAll((els) => els.map((e) => [e.getAttribute("data-medal"), e.textContent]));
  let docUrl = "", verifyHref = "";

  await step(tag("daftar; dasbor dan daftar dokumen menawarkan unggah (flag AI_PREREVIEW_ENABLED menyala)"), async () => {
    await register(page, base, email);
    const dash = await clean("/dashboard");
    if (!dash.includes("Analisis dokumen yang sudah Anda miliki")) throw new Error("dasbor tanpa tautan unggah");
    await page.goto(base + "/documents");
    await clean("/documents");
    if (!(await page.locator("a[href='/documents/upload']").count())) throw new Error("daftar dokumen tanpa tombol unggah");
  });

  await step(tag("unggah TXT sintetis + persetujuan → analisis awal AI selesai → AI Verified terbit; laporan dengan medali bronze"), async () => {
    await page.goto(base + "/documents/upload");
    await clean("/documents/upload");
    await page.setInputFiles("input[name=file]", { name: "sewa-gerobak.txt", mimeType: "text/plain", buffer: Buffer.from(TXT) });
    await page.check("input[name=consent]");
    await Promise.all([page.waitForURL(/\/documents\/[0-9a-f-]{36}\?/, { timeout: 60000 }), page.click("button:has-text('Mulai analisis awal')")]);
    const text = await clean("halaman dokumen");
    docUrl = page.url().split("?")[0];
    for (const s of ["Berkas berhasil diunggah", "Analisis awal AI selesai", AI_TITLE, AI_STATEMENT, "Bukan Legal Verified", "Sewa Rp300.000 per bulan"]) if (!text.includes(s)) throw new Error(`halaman dokumen tanpa "${s}"`);
    const docId = docUrl.split("/").at(-1);
    const kinds = (await db.query("select v.kind, v.status from document_verifications v join document_versions dv on dv.id = v.version_id where dv.document_id = $1", [docId])).rows;
    if (JSON.stringify(kinds) !== JSON.stringify([{ kind: "AI", status: "ACTIVE" }])) throw new Error("rekaman verifikasi: " + JSON.stringify(kinds));
    const m = await medals(page);
    if (m.length !== 2 || m.some(([tier, t]) => tier !== "bronze" || /legal|\bsah\b|terjamin/i.test(t))) throw new Error("medali halaman dokumen: " + JSON.stringify(m));
    verifyHref = await page.locator("a[href*='/verify/']").first().getAttribute("href");
    await shot("prod-ai-dokumen");
  });

  await step(tag("/verify rekaman AI (tanpa login): Aktif, medali bronze, penjelasan bukan pemeriksaan profesional, tanpa galat"), async () => {
    if (!verifyHref) throw new Error("langkah unggah tidak menghasilkan tautan /verify");
    const anon = await newActor("prod-ai-publik");
    const code = new URL(verifyHref).pathname.split("/").at(-1);
    await anon.page.goto(base + "/verify/" + code);
    await anon.page.waitForLoadState("networkidle");
    const text = await anon.page.innerText("body");
    for (const s of ["Status: Aktif", AI_TITLE, AI_STATEMENT]) if (!text.includes(s)) throw new Error(`/verify tanpa "${s}"`);
    if (text.includes("Terjadi kendala")) throw new Error("/verify: halaman galat");
    const m = await medals(anon.page);
    if (m.map(([t]) => t).join() !== "bronze") throw new Error("medali /verify: " + JSON.stringify(m));
    if (anon.issues.length) throw new Error("/verify error konsol: " + anon.issues.join(" | "));
    await anon.shot("prod-ai-verify");
  });
}

// Unggah dokumen + analisis awal AI (Task 6, flag AI_PREREVIEW_ENABLED menyala di lingkungan E2E; LLM palsu startFakeLlm).
// Pemilik A mengunggah DOCX sintetis (dibuat di tes dengan pustaka docx) → persetujuan → hasil berkelompok + AI Verified terpisah
// dari Legal Verified → jatah berkurang (dokumen baru habis untuk Free). Pemilik B mengunggah TXT; B tidak dapat membuka dokumen A.
// Pemilik C mengunggah dokumen berisiko tinggi → diarahkan ke penilaian khusus tanpa memanggil AI. 375px: tanpa overflow,
// target sentuh >= 43.5px, tanpa error konsol. Perilaku flag MATI diuji di tests/unit/uploads.test.ts.
import { Document, Packer, Paragraph } from "docx";
import { register } from "./helpers.mjs";

export const onlyViewport = "desktop";
const LABEL = "Analisis awal AI bersifat informasional dan dapat keliru.";
const GROUPS = ["Hal yang perlu diperhatikan", "Informasi yang belum jelas", "Saran pertanyaan untuk pengacara"];
const AI_TITLE = "Yuktanya AI Verified — Pemeriksaan Awal oleh AI";
const HP = { name: "hp", width: 375, height: 800 };
const TXT = "Perjanjian Titip Jual Kerajinan (sintetis)\n\nPasal 1\nPihak Pertama menitipkan 40 tas anyaman kepada Pihak Kedua.\n\nPasal 2\nHasil penjualan dibagi 70:30 setiap akhir bulan.";
const RISKY = "Akta jual beli tanah (sintetis)\n\nObjek: sebidang tanah bersertifikat hak milik di desa contoh.";

const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const smallTargets = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("a[href], button, input:not([type=hidden]):not([type=checkbox]), select, textarea, summary")]
      .filter((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && !e.closest("[aria-hidden=true]") && !e.closest("nextjs-portal") && r.height < 43.5; })
      .map((e) => `${e.tagName.toLowerCase()}:${(e.textContent || e.getAttribute("name") || "").trim().slice(0, 24)}:${Math.round(e.getBoundingClientRect().height)}px`),
  );

async function docxBytes() {
  const doc = new Document({ sections: [{ children: [
    new Paragraph({ text: "Perjanjian Kerja Sama Katering (sintetis)" }),
    new Paragraph({ text: "Pasal 1 — Pihak Pertama menyediakan 100 porsi makan siang untuk acara Pihak Kedua." }),
    new Paragraph({ text: "Pasal 2 — Pembayaran 50% di muka & sisanya setelah acara." }),
  ] }] });
  return Buffer.from(await Packer.toBuffer(doc));
}

export async function journey({ step, base, db, llm, newActor }) {
  const n = Date.now();
  const mail = (who) => `ai-${who}+${n}@example.com`;
  const tag = (s) => `[ai-review] ${s}`;
  const actors = { a: await newActor("ai-a"), b: await newActor("ai-b"), c: await newActor("ai-c") };
  const browser = actors.a.page.context().browser();
  const ids = {};
  let docA = "", docB = "";

  const contexts = [];
  const open = async (who, w) => {
    const ctx = await browser.newContext({ viewport: { width: w.width, height: w.height }, storageState: await actors[who].page.context().storageState() });
    contexts.push(ctx);
    const page = await ctx.newPage();
    const issues = [];
    page.on("console", (m) => { if (m.type() === "error") issues.push(m.text().slice(0, 500)); });
    page.on("pageerror", (e) => issues.push(`pageerror: ${e.message}`.slice(0, 500)));
    return { page, issues };
  };
  const checkPage = async (o, w, path, markers = []) => {
    const r = await o.page.goto(base + path);
    await o.page.waitForLoadState("networkidle");
    if (!r || r.status() !== 200) throw new Error(`${path}: status ${r?.status()}`);
    const text = await o.page.innerText("body");
    for (const m of markers) if (!text.includes(m)) throw new Error(`${path}: penanda hilang "${m}"`);
    if (/\bcap\b/i.test(text)) throw new Error(`${path}: kata "cap" muncul`);
    const over = await overflow(o.page);
    if (over > 1) {
      const wide = await o.page.evaluate((vw) => [...document.querySelectorAll("main *")].filter((e) => e.getBoundingClientRect().right > vw + 1)
        .slice(-4).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 40)}:${Math.round(e.getBoundingClientRect().right)}`), w.width);
      throw new Error(`${path} @${w.width}px meluap ${over}px: ${wide.join(" | ")}`);
    }
    const bad = await smallTargets(o.page);
    if (bad.length) throw new Error(`${path} @${w.width}px target kecil: ${bad.slice(0, 6).join(" | ")}`);
    if (o.issues.length) throw new Error(`${path} @${w.width}px error konsol: ${o.issues.splice(0).join(" | ")}`);
    await o.page.screenshot({ path: `${process.env.SHOTS_DIR ?? "/tmp/yk-shots"}/ai-review-${w.name}-${path.replace(/\W+/g, "-")}.png`, fullPage: true }).catch(() => {});
  };
  const uploadAndAnalyze = async (p, file) => {
    await p.goto(base + "/documents/upload");
    await p.setInputFiles("input[name=file]", file);
    await p.check("input[name=consent]");
    await Promise.all([p.waitForURL(/\/documents\/[0-9a-f-]{36}\?/, { timeout: 60000 }), p.click("button:has-text('Mulai Analisis Awal')")]);
    await p.waitForLoadState("networkidle");
    return p.url().split("?")[0];
  };

  await step(tag("siapkan tiga pemilik Free; dasbor menautkan halaman unggah; jatah awal tampil"), async () => {
    for (const [who, a] of Object.entries(actors)) {
      await register(a.page, base, mail(who));
      ids[who] = (await db.query("select id from auth.users where email = $1", [mail(who)])).rows[0].id;
    }
    const p = actors.a.page;
    await Promise.all([p.waitForURL("**/documents/upload"), p.click("a:has-text('Periksa dokumen yang sudah Anda punya')")]);
    const t = await p.innerText("main");
    for (const s of ["Periksa dokumen yang sudah Anda punya", "Dokumen baru: 1 dari 1", "Analisis AI: 2 dari 2", "FreeLLMAPI", "5 MB"]) if (!t.includes(s)) throw new Error(`halaman unggah tanpa "${s}"`);
  });

  await step(tag("A: unggah DOCX sintetis + persetujuan → versi beku, hasil berkelompok, label wajib, AI Verified terpisah"), async () => {
    const p = actors.a.page;
    const before = llm.control.prereview ?? 0;
    docA = await uploadAndAnalyze(p, { name: "Kerja_Sama_Katering.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: await docxBytes() });
    const t = await p.innerText("main");
    for (const s of ["Berkas berhasil diunggah", "Analisis awal AI selesai", LABEL, ...GROUPS, AI_TITLE, "Bukan Legal Verified", "belum ada batas tanggung jawab", "Apakah perlu klausul denda keterlambatan?", "Pasal 2 — Pembayaran 50% di muka & sisanya setelah acara.", "Kerja_Sama_Katering.docx"]) {
      if (!t.includes(s)) throw new Error(`halaman dokumen tanpa "${s}"`);
    }
    if (t.includes("Yuktanya Legal Verified")) throw new Error("Legal Verified muncul untuk hasil AI");
    if ((llm.control.prereview ?? 0) !== before + 1) throw new Error("LLM palsu tidak menerima tepat satu permintaan analisis");
    if (!llm.seen.every((s) => s.model === "auto")) throw new Error("model bukan 'auto'");
    const docId = docA.split("/").at(-1);
    const row = (await db.query("select d.category, d.owner_id, u.file_kind, u.risk_level from documents d join document_uploads u on u.document_id = d.id where d.id = $1", [docId])).rows[0];
    if (row?.category !== "UPLOAD" || row.owner_id !== ids.a || row.file_kind !== "DOCX" || row.risk_level !== "NORMAL") throw new Error("baris DB: " + JSON.stringify(row));
    const kinds = (await db.query("select kind from document_verifications v join document_versions dv on dv.id = v.version_id where dv.document_id = $1", [docId])).rows.map((r) => r.kind).join(",");
    if (kinds !== "AI") throw new Error("verifikasi: " + kinds);
  });

  await step(tag("A: jatah berkurang — analisis AI 1 dari 2, dokumen baru habis (TXT kedua tidak bisa diunggah hari ini)"), async () => {
    const p = actors.a.page;
    await p.goto(base + "/documents/upload");
    const t = await p.innerText("main");
    if (!t.includes("Analisis AI: 1 dari 2")) throw new Error("jatah analisis tidak berkurang: " + t.slice(0, 600));
    if (!t.includes("Dokumen baru: 0 dari 1") || !t.includes("Batas dokumen baru hari ini sudah tercapai")) throw new Error("jatah dokumen tidak berkurang");
    if (await p.locator("input[name=file]").count()) throw new Error("form unggah masih tampil saat jatah dokumen habis");
    const used = (await db.query("select quota_type, count(*)::int as n from ai_usage_reservations where user_id = $1 and status = 'FINALIZED' group by quota_type order by quota_type", [ids.a])).rows.map((r) => `${r.quota_type}:${r.n}`).join(",");
    if (used !== "DOCUMENT:1,MESSAGE:1,REVIEW:1") throw new Error("pemakaian jatah: " + used);
  });

  await step(tag("B: unggah TXT → hasil berkelompok; B tidak dapat membuka dokumen A (404, isi tidak bocor)"), async () => {
    const p = actors.b.page;
    docB = await uploadAndAnalyze(p, { name: "titip-jual.txt", mimeType: "text/plain", buffer: Buffer.from(TXT) });
    const t = await p.innerText("main");
    for (const s of [LABEL, ...GROUPS, "Hasil penjualan dibagi 70:30 setiap akhir bulan."]) if (!t.includes(s)) throw new Error(`dokumen TXT tanpa "${s}"`);
    const r = await p.goto(docA);
    if (r.status() !== 404) throw new Error("B membuka dokumen A: status " + r.status());
    if ((await p.innerText("body")).includes("Katering")) throw new Error("isi dokumen A bocor ke B");
    const r2 = await actors.a.page.goto(docB);
    if (r2.status() !== 404) throw new Error("A membuka dokumen B: status " + r2.status());
  });

  await step(tag("C: dokumen berisiko tinggi → tidak dianalisis AI, diarahkan ke penilaian khusus, tanpa tombol Review Standar"), async () => {
    const p = actors.c.page;
    const before = llm.control.prereview ?? 0;
    await uploadAndAnalyze(p, { name: "akta-tanah.txt", mimeType: "text/plain", buffer: Buffer.from(RISKY) });
    const t = await p.innerText("main");
    if (!t.includes("Dokumen ini memerlukan penilaian khusus")) throw new Error("pesan penilaian khusus tidak tampil");
    for (const s of GROUPS) if (t.includes(s)) throw new Error("hasil AI palsu tampil untuk dokumen berisiko tinggi");
    if ((llm.control.prereview ?? 0) !== before) throw new Error("AI dipanggil untuk dokumen berisiko tinggi");
    if (await p.locator("button:has-text('Minta pemeriksaan pengacara')").count()) throw new Error("tombol Review Standar tampil");
    if (await p.locator("button:has-text('Analisis awal AI')").count()) throw new Error("tombol analisis AI tampil");
    await Promise.all([p.waitForURL(/\/cases\/new\?document=/), p.click("a:has-text('Ajukan penilaian khusus')")]);
    const used = (await db.query("select count(*)::int as n from ai_usage_reservations where user_id = $1 and quota_type = 'REVIEW' and status = 'FINALIZED'", [ids.c])).rows[0].n;
    if (used !== 0) throw new Error("jatah review terpakai: " + used);
  });

  await step(tag("@375px: /documents/upload dan halaman hasil tanpa overflow, target sentuh >= 43.5px, tanpa error konsol"), async () => {
    const fresh = await newActor("ai-d");
    await register(fresh.page, base, mail("d"));
    const d = { page: fresh.page, issues: fresh.issues };
    await d.page.setViewportSize({ width: HP.width, height: HP.height });
    await checkPage(d, HP, "/documents/upload", ["Mulai Analisis Awal", LABEL]);
    const o = await open("a", HP);
    await checkPage(o, HP, new URL(docA).pathname, [LABEL, ...GROUPS, AI_TITLE]);
    await checkPage(o, HP, "/documents", ["Dokumen unggahan"]);
  });

  for (const c of contexts) await c.close();
}

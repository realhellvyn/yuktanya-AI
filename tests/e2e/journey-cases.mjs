// Kasus Hukum Khusus (Task 5): pemilik mengajukan dari halaman dokumen → koordinator triase & menawar → pemilik menerima →
// status terlihat di kedua sisi; Review Standar tertutup untuk dokumen itu; pengguna lain 404; halaman baru 375px tanpa overflow,
// target sentuh >= 43.5px, tanpa error konsol. Data aktor disiapkan lewat UI pendaftaran + DB.
import { createNdaVersion, register, submit } from "./helpers.mjs";

export const onlyViewport = "desktop";
const NOTE = "Biaya dan ruang lingkup ditentukan setelah asesmen profesional.";
const SUMMARY = "Perjanjian distribusi lintas provinsi dengan klausul eksklusivitas dan denda besar (sintetis).";
const SCOPE = "Telaah kontrak distribusi dan satu kali rapat daring (sintetis).";
const HP = { name: "hp", width: 375, height: 800 };

const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const smallTargets = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("a[href], button, input:not([type=hidden]):not([type=checkbox]), select, textarea, summary")]
      .filter((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && !e.closest("[aria-hidden=true]") && !e.closest("nextjs-portal") && r.height < 43.5; })
      .map((e) => `${e.tagName.toLowerCase()}:${(e.textContent || e.getAttribute("name") || "").trim().slice(0, 24)}:${Math.round(e.getBoundingClientRect().height)}px`),
  );
const ymdWib = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(d);

export async function journey({ step, base, db, newActor }) {
  const n = Date.now();
  const mail = (who) => `kasus-${who}+${n}@example.com`;
  const tag = (s) => `[kasus] ${s}`;
  const actors = { admin: await newActor("kasus-admin"), koordinator: await newActor("kasus-koordinator"), pemilik: await newActor("kasus-pemilik"), lain: await newActor("kasus-lain") };
  const browser = actors.admin.page.context().browser();
  const ids = {};
  let docUrl = "", caseId = "";

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
  const checkPage = async (a, w, path, markers = []) => {
    const r = await a.page.goto(base + path);
    await a.page.waitForLoadState("networkidle");
    if (!r || r.status() !== 200) throw new Error(`${path}: status ${r?.status()}`);
    if (new URL(a.page.url()).pathname !== path.split("?")[0]) throw new Error(`${path} dialihkan ke ${a.page.url()}`);
    const text = await a.page.innerText("body");
    for (const m of markers) if (!text.includes(m)) throw new Error(`${path}: penanda hilang "${m}"`);
    if (/\bcap\b/i.test(text)) throw new Error(`${path}: kata "cap" muncul`);
    const over = await overflow(a.page);
    if (over > 1) throw new Error(`${path} @${w.width}px meluap ${over}px`);
    const bad = await smallTargets(a.page);
    if (bad.length) throw new Error(`${path} @${w.width}px target kecil: ${bad.slice(0, 6).join(" | ")}`);
    if (a.issues.length) throw new Error(`${path} @${w.width}px error konsol: ${a.issues.splice(0).join(" | ")}`);
    await a.page.screenshot({ path: `${process.env.SHOTS_DIR ?? "/tmp/yk-shots"}/kasus-${w.name}-${path.replace(/\W+/g, "-")}.png`, fullPage: true }).catch(() => {});
  };

  await step(tag("siapkan aktor: admin, firma bawaan + koordinator, pemilik dengan dokumen NDA, pengguna lain"), async () => {
    for (const [who, a] of Object.entries(actors)) {
      await register(a.page, base, mail(who));
      ids[who] = (await db.query("select id from auth.users where email = $1", [mail(who)])).rows[0].id;
    }
    await db.query("insert into public.user_roles (user_id, role) values ($1, 'platform_admin') on conflict do nothing", [ids.admin]);
    await db.query("update firms set is_default = false");
    const firm = (await db.query("select admin_register_firm($1, $2, true) as id", [ids.admin, `Firma Kasus ${n}`])).rows[0].id;
    await db.query("select admin_add_member($1, $2, $3, 'coordinator')", [ids.admin, firm, ids.koordinator]);
    docUrl = await createNdaVersion(actors.pemilik.page, base);
  });

  await step(tag("pemilik: dari halaman dokumen ke /cases/new, salinan wajib, consent, kirim → status Diajukan"), async () => {
    const p = actors.pemilik.page;
    await p.goto(docUrl);
    await Promise.all([p.waitForURL(/\/cases\/new\?document=/), p.click("a:has-text('Ajukan penilaian khusus')")]);
    const text = await p.innerText("main");
    if (!text.includes(NOTE)) throw new Error("salinan wajib tidak tampil persis di /cases/new");
    await p.fill("textarea[name=summary]", SUMMARY);
    await p.check("input[name=consent]");
    await submit(p, p.locator("button:has-text('Kirim permintaan penilaian')"));
    const m = /\/cases\/([0-9a-f-]{36})/.exec(p.url());
    if (!m) throw new Error("tidak diarahkan ke halaman kasus: " + p.url());
    caseId = m[1];
    const t = await p.innerText("main");
    for (const s of ["Permintaan terkirim", "Diajukan, menunggu penilaian firma", NOTE]) if (!t.includes(s)) throw new Error(`halaman kasus tanpa "${s}"`);
    const ev = (await db.query("select count(*)::int as n from product_events where entity_id = $1 and event_name = 'special_case_requested'", [caseId])).rows[0].n;
    if (ev !== 1) throw new Error("event special_case_requested: " + ev);
  });

  await step(tag("dokumen berkasus khusus: pesan penilaian khusus, tanpa tombol Review Standar"), async () => {
    const p = actors.pemilik.page;
    await p.goto(docUrl);
    const t = await p.innerText("main");
    if (!t.includes("Dokumen ini memerlukan penilaian khusus")) throw new Error("pesan penilaian khusus tidak tampil di halaman dokumen");
    if (await p.locator("button:has-text('Minta pemeriksaan pengacara')").count()) throw new Error("tombol Review Standar masih tampil");
  });

  await step(tag("pengguna lain mendapat 404; koordinator tidak memakai /cases; admin tidak melihat ringkasan"), async () => {
    const r = await actors.lain.page.goto(base + `/cases/${caseId}`);
    if (r.status() !== 404) throw new Error("pengguna lain mendapat status " + r.status());
    if ((await actors.lain.page.innerText("body")).includes("distribusi")) throw new Error("ringkasan bocor ke pengguna lain");
    await actors.koordinator.page.goto(base + `/cases/${caseId}`);
    if (new URL(actors.koordinator.page.url()).pathname.startsWith("/cases")) throw new Error("koordinator membuka permukaan pemilik");
    await actors.admin.page.goto(base + "/admin/cases");
    const t = await actors.admin.page.innerText("main");
    if (!t.includes("Kasus khusus") || !t.includes(`Firma Kasus ${n}`)) throw new Error("admin tidak melihat daftar kasus");
    if (t.includes("distribusi")) throw new Error("ringkasan pemilik tampil di admin");
    const r2 = await actors.admin.page.goto(base + `/partner/cases/${caseId}`);
    if (new URL(actors.admin.page.url()).pathname.startsWith("/partner")) throw new Error("admin membuka halaman kasus mitra: " + r2?.status());
  });

  await step(tag("koordinator: /partner/cases → triase (cek konflik) → kirim penawaran"), async () => {
    const p = actors.koordinator.page;
    await p.goto(base + "/partner/cases");
    if (!(await p.locator("nav a[href='/partner/cases']").count())) throw new Error("menu Kasus khusus tidak tampil untuk koordinator");
    await Promise.all([p.waitForURL(`**/partner/cases/${caseId}`), p.click(`a[href='/partner/cases/${caseId}']`)]);
    if (!(await p.innerText("main")).includes(SUMMARY)) throw new Error("koordinator tidak melihat ringkasan");
    await p.check("input[name=conflictCleared]");
    await submit(p, p.locator("button:has-text('Simpan triase')"));
    if (!(await p.innerText("main")).includes("Triase tersimpan")) throw new Error("triase tanpa pesan sukses");
    await p.fill("input[name=amount]", "2.500.000");
    await p.fill("textarea[name=scope]", SCOPE);
    await p.fill("input[name=expiresOn]", ymdWib(new Date(Date.now() + 7 * 86_400_000)));
    await submit(p, p.locator("button:has-text('Kirim penawaran')"));
    const t = await p.innerText("main");
    if (!t.includes("Penawaran terkirim") || !t.includes("2.500.000")) throw new Error("penawaran tidak tersimpan: " + t.slice(0, 400));
    const st = (await db.query("select status from special_cases where id = $1", [caseId])).rows[0].status;
    if (st !== "QUOTED") throw new Error("status DB " + st);
  });

  await step(tag("pemilik: melihat penawaran lalu menerima eksplisit → ACCEPTED, tanpa order/pembayaran baru"), async () => {
    const p = actors.pemilik.page;
    const before = (await db.query("select count(*)::int as n from orders where user_id = $1", [ids.pemilik])).rows[0].n;
    await p.goto(base + `/cases/${caseId}`);
    const t = await p.innerText("main");
    for (const s of ["Penawaran dikirim", "2.500.000", SCOPE, "Berlaku sampai", "belum membuat tagihan"]) if (!t.includes(s)) throw new Error(`penawaran tanpa "${s}"`);
    await p.check("input[name=confirm]");
    await submit(p, p.locator("button:has-text('Terima penawaran')"));
    const t2 = await p.innerText("main");
    if (!t2.includes("Anda menerima penawaran") || !t2.includes("Penawaran diterima")) throw new Error("status diterima tidak tampil: " + t2.slice(0, 300));
    const after = (await db.query("select count(*)::int as n from orders where user_id = $1", [ids.pemilik])).rows[0].n;
    if (after !== before) throw new Error(`order bertambah setelah menerima penawaran: ${before} → ${after}`);
    const evs = (await db.query("select event_name from product_events where entity_id = $1 order by event_name", [caseId])).rows.map((r) => r.event_name).join(",");
    if (evs !== "special_case_quote_accepted,special_case_quote_sent,special_case_requested") throw new Error("event: " + evs);
    await actors.koordinator.page.goto(base + `/partner/cases/${caseId}`);
    if (!(await actors.koordinator.page.innerText("main")).includes("Diterima pemilik")) throw new Error("koordinator tidak melihat penerimaan");
  });

  await step(tag("@375px: /cases, /cases/new, /cases/[id], /partner/cases, /partner/cases/[id], /admin/cases tanpa overflow, target sentuh, error konsol"), async () => {
    const o = await open("pemilik", HP);
    await checkPage(o, HP, "/cases", ["Kasus Khusus", NOTE]);
    await checkPage(o, HP, "/cases/new", [NOTE, "Kirim permintaan penilaian"]);
    await checkPage(o, HP, `/cases/${caseId}`, ["Penawaran diterima"]);
    const k = await open("koordinator", HP);
    await checkPage(k, HP, "/partner/cases", ["Kasus khusus", "Penawaran diterima"]);
    await checkPage(k, HP, `/partner/cases/${caseId}`, ["Diterima pemilik", "Tutup kasus"]);
    const a = await open("admin", HP);
    await checkPage(a, HP, "/admin/cases", ["Kasus khusus"]);
  });

  for (const c of contexts) await c.close();
}

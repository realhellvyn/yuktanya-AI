// Tampilan dashboard mitra & admin (Task 3): data disiapkan lewat DB, lalu setiap halaman kunci diperiksa pada lebar 375px dan 1280px:
// tanpa overflow horizontal, target sentuh >= 44px, tanpa error konsol; /partner/team khusus koordinator; tab HP editor; konfirmasi akhir.
import { createNdaVersion, register, submit } from "./helpers.mjs";

export const onlyViewport = "desktop";
const WIDTHS = [{ name: "hp", width: 375, height: 800 }, { name: "desktop", width: 1280, height: 800 }];
const ADMIN_PAGES = ["/admin", "/admin/payments", "/admin/routing", "/admin/partners", "/admin/verifications", "/admin/rubric", "/admin/features",
  "/admin/analytics", "/admin/ai-usage", "/admin/reviews", "/admin/revenue", "/admin/users", "/admin/incidents"];

const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
// Logika sama dengan journey-public.mjs: elemen interaktif terlihat yang tingginya < 43.5px.
const smallTargets = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("a[href], button, input:not([type=hidden]):not([type=checkbox]), select, textarea, summary")]
      .filter((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && !e.closest("[aria-hidden=true]") && !e.closest("nextjs-portal") && r.height < 43.5; })
      .map((e) => `${e.tagName.toLowerCase()}:${(e.textContent || e.getAttribute("name") || "").trim().slice(0, 24)}:${Math.round(e.getBoundingClientRect().height)}px`),
  );
const ymd = (d) => d.toISOString().slice(0, 10);
const rand = () => Math.random().toString(36).slice(2);

export async function journey({ step, base, db, newActor }) {
  const n = Date.now();
  const mail = (who) => `ui-${who}+${n}@example.com`;
  const tag = (s) => `[ui-peran] ${s}`;
  const actors = { admin: await newActor("ui-admin"), koordinator: await newActor("ui-koordinator"), reviewer: await newActor("ui-reviewer"), pemilik1: await newActor("ui-pemilik1"), pemilik2: await newActor("ui-pemilik2") };
  const browser = actors.admin.page.context().browser();
  const ids = {};
  let req1 = "", deepId = "", sha1 = "";

  const buy = async (owner, kind, ref) => {
    const now = new Date();
    const o = (await db.query("select * from create_order($1, $2, $3, $4, $5)", [owner, kind, ref, `ui-${rand()}-abcdef`, now])).rows[0];
    const pref = `ui-ref-${rand()}`;
    await db.query("select create_payment($1, $2, 'mock', $3, $4)", [owner, o.order_id, pref, now]);
    const r = (await db.query("select settle_payment('mock', $1, $2, $3, 0, $4) as r", [pref, `ui-ev-${rand()}`, o.amount_idr, now])).rows[0].r;
    if (r !== "SETTLED") throw new Error(`${kind} tidak lunas: ${r}`);
    return o.order_id;
  };

  await step(tag("siapkan data lewat DB: admin, firma bawaan, koordinator, reviewer berotorisasi, satu Review Standar ditugaskan, satu Pemeriksaan Mendalam ditugaskan"), async () => {
    for (const [who, a] of Object.entries(actors)) {
      await register(a.page, base, mail(who));
      ids[who] = (await db.query("select id from auth.users where email = $1", [mail(who)])).rows[0].id;
    }
    await db.query("insert into public.user_roles (user_id, role) values ($1, 'platform_admin') on conflict do nothing", [ids.admin]);
    await db.query("update firms set is_default = false");
    const firm = (await db.query("select admin_register_firm($1, $2, true) as id", [ids.admin, `Firma UI ${n}`])).rows[0].id;
    await db.query("select admin_add_member($1, $2, $3, 'coordinator')", [ids.admin, firm, ids.koordinator]);
    await db.query("select admin_add_member($1, $2, $3, 'reviewer')", [ids.admin, firm, ids.reviewer]);
    const day = 86_400_000;
    await db.query("select admin_authorize($1, $2, $3, 'Perjanjian kerahasiaan', $4, $5)", [ids.admin, ids.reviewer, firm, ymd(new Date(Date.now() - 30 * day)), ymd(new Date(Date.now() + 365 * day))]);

    const version = async (who) => {
      await createNdaVersion(actors[who].page, base);
      return (await db.query("select v.id, v.sha256 from document_versions v join documents d on d.id = v.document_id where d.owner_id = $1 order by v.created_at desc limit 1", [ids[who]])).rows[0];
    };
    const v1 = await version("pemilik1");
    sha1 = v1.sha256;
    const o1 = await buy(ids.pemilik1, "STANDARD_REVIEW", v1.id);
    req1 = (await db.query("select id from review_requests where order_id = $1", [o1])).rows[0].id;
    await db.query("select assign_review($1, $2, $3, $4)", [ids.koordinator, req1, ids.reviewer, new Date()]);

    const v2 = await version("pemilik2");
    const o2 = await buy(ids.pemilik2, "STANDARD_REVIEW", v2.id);
    const req2 = (await db.query("select id from review_requests where order_id = $1", [o2])).rows[0].id;
    const now = new Date();
    await db.query("select assign_review($1, $2, $3, $4)", [ids.koordinator, req2, ids.reviewer, now]);
    let rev = (await db.query("select * from start_review($1, $2, $3)", [ids.reviewer, req2, now])).rows[0].revision;
    rev = (await db.query("select save_report_draft($1, $2, $3, 'Klausul kerahasiaan dan jangka waktu', '', '', $4) as r", [ids.reviewer, req2, rev, now])).rows[0].r;
    const note = { title: "Definisi informasi rahasia sempit", finding: "Hanya daftar pelanggan.", severity: "MATERIAL", actionable: true, recommended_action: "Perluas definisi.", rationale: "Risiko kebocoran.", escalation: "Konsultasi bila sengketa." };
    rev = (await db.query("select * from upsert_note($1, $2, $3, $4, $5)", [ids.reviewer, req2, rev, JSON.stringify(note), now])).rows[0].revision;
    await db.query("select * from publish_standard($1, $2, $3, 'WITH_NOTES', false, true, $4)", [ids.reviewer, req2, rev, now]);
    const o3 = await buy(ids.pemilik2, "DEEP_REVIEW", req2);
    deepId = (await db.query("select id from deep_requests where order_id = $1", [o3])).rows[0].id;
    await db.query("select assign_deep($1, $2, $3, $4)", [ids.koordinator, deepId, ids.reviewer, new Date()]);
  });

  // Konteks per lebar layar memakai sesi (cookie) akun yang sama.
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
  // Buka halaman lalu periksa: tidak dialihkan, tanpa overflow, target sentuh, tanpa error konsol, judul tab (bila diminta).
  const checkPage = async (a, w, path, { title, markers = [] } = {}) => {
    const r = await a.page.goto(base + path);
    await a.page.waitForLoadState("networkidle");
    if (!r || r.status() !== 200) throw new Error(`${path}: status ${r?.status()}`);
    if (new URL(a.page.url()).pathname !== path) throw new Error(`${path} dialihkan ke ${a.page.url()}`);
    const text = await a.page.innerText("body");
    for (const m of markers) if (!text.includes(m)) throw new Error(`${path}: penanda hilang "${m}"`);
    if (/\bcap\b/i.test(text)) throw new Error(`${path}: kata "cap" muncul`);
    if (title && !(await a.page.title()).includes(title)) throw new Error(`${path}: judul "${await a.page.title()}" tanpa "${title}"`);
    const over = await overflow(a.page);
    if (over > 1) throw new Error(`${path} @${w.width}px meluap ${over}px`);
    const bad = await smallTargets(a.page);
    if (bad.length) throw new Error(`${path} @${w.width}px target kecil: ${bad.slice(0, 6).join(" | ")}`);
    if (a.issues.length) throw new Error(`${path} @${w.width}px error konsol: ${a.issues.splice(0).join(" | ")}`);
    await a.page.screenshot({ path: `${process.env.SHOTS_DIR ?? "/tmp/yk-shots"}/ui-${w.name}-${path.replace(/\W+/g, "-")}.png`, fullPage: true }).catch(() => {});
  };

  await step(tag("akun reviewer saja ditolak di /partner/team dan /admin; koordinator saja tidak melihat menu Siap diputuskan"), async () => {
    const a = await open("reviewer", WIDTHS[0]);
    for (const p of ["/partner/team", "/admin", "/admin/partners"]) {
      await a.page.goto(base + p);
      const at = new URL(a.page.url()).pathname;
      if (at.startsWith(p)) throw new Error(`${p} terbuka untuk reviewer: ${a.page.url()}`);
      if (/Tim firma|Dashboard Admin Platform/.test(await a.page.locator("main").innerText())) throw new Error(`${p} membocorkan isi ke reviewer`);
    }
    if (await a.page.locator("a[href='/partner/team']").count()) throw new Error("menu Tim firma tampil untuk reviewer");
    const c = await open("koordinator", WIDTHS[1]);
    await c.page.goto(base + "/partner");
    if (!(await c.page.locator("a[href='/partner/team']").count())) throw new Error("menu Tim firma tidak tampil untuk koordinator");
    if (await c.page.locator("a[href='/partner/approvals']").count()) throw new Error("menu Siap diputuskan tampil untuk koordinator saja");
  });

  for (const w of WIDTHS) {
    await step(tag(`@${w.width}px koordinator: /partner dan /partner/team (email reviewer, pekerjaan aktif, otorisasi aktif)`), async () => {
      const a = await open("koordinator", w);
      await checkPage(a, w, "/partner", { title: "Review Standar", markers: ["Dashboard Mitra Hukum"] });
      await checkPage(a, w, "/partner/team", { title: "Tim Firma", markers: ["Tim firma", mail("reviewer"), "Otorisasi aktif", "Pekerjaan aktif di firma ini: 2", "Tugaskan permintaan"] });
      if (await a.page.locator("main form").count()) throw new Error("halaman tim tidak boleh punya form pemberian peran/otorisasi");
    });

    await step(tag(`@${w.width}px reviewer: /partner/approvals menjelaskan yang belum siap; tanpa tombol bayar`), async () => {
      const a = await open("reviewer", w);
      await checkPage(a, w, "/partner/approvals", { title: "Review Standar", markers: ["Siap diputuskan", "Review Standar", "Pemeriksaan Mendalam", "Belum dibuka", "Belum siap"] });
      if (await a.page.locator("main button:has-text('Bayar'), main a:has-text('Bayar')").count()) throw new Error("ada kontrol bayar di halaman persetujuan");
      await checkPage(a, w, "/partner", { markers: ["Review Standar saya", "Pemeriksaan mendalam saya"] });
    });
  }

  // Editor dibuka setelah semua pemeriksaan daftar persetujuan (membuka editor mengubah status menjadi "Sedang diperiksa").
  for (const w of WIDTHS) {

    await step(tag(`@${w.width}px reviewer: editor Review Standar dan Pemeriksaan Mendalam (judul memuat jenis review, tab HP)`), async () => {
      const a = await open("reviewer", w);
      await checkPage(a, w, `/partner/reviews/${req1}`, { title: "Review Standar", markers: ["Versi 1", "Isi dokumen yang diperiksa"] });
      const tabs = a.page.locator("[role=tablist] [role=tab]");
      if (w.width < 1280) {
        const labels = (await tabs.allInnerTexts()).map((t) => t.trim());
        if (labels.join("|") !== "Dokumen|Catatan|Pemeriksaan|Hasil") throw new Error("tab: " + labels.join("|"));
        if (await a.page.locator("#panel-hasil").isVisible()) throw new Error("panel Hasil terlihat sebelum tab dipilih");
        await a.page.click("[role=tab]:has-text('Hasil')");
        await a.page.locator("#panel-hasil").waitFor({ state: "visible" });
        if (await a.page.locator("#panel-dokumen").isVisible()) throw new Error("panel Dokumen tetap terlihat");
        const hasil = await a.page.locator("#panel-hasil").innerText();
        if (!hasil.includes("Belum bisa diterbitkan") || !hasil.includes("Isi ruang lingkup")) throw new Error("tombol nonaktif tanpa alasan tertulis: " + hasil.slice(0, 300));
        if (!(await a.page.locator("#panel-hasil button:has-text('Terbitkan hasil')").isDisabled())) throw new Error("Terbitkan aktif padahal lingkup kosong");
        const over = await overflow(a.page);
        if (over > 1) throw new Error("tab Hasil meluap " + over);
      } else {
        if (await a.page.locator("[role=tablist]").isVisible()) throw new Error("tab HP tampil di desktop");
        for (const p of ["dokumen", "catatan", "pemeriksaan", "hasil"]) if (!(await a.page.locator(`#panel-${p}`).isVisible())) throw new Error(`panel ${p} tersembunyi di desktop`);
      }
      await checkPage(a, w, `/partner/deep/${deepId}`, { title: "Pemeriksaan Mendalam", markers: ["Pemeriksaan mendalam", "Isi dokumen yang diperiksa"] });
      if (w.width < 1280) {
        await a.page.click("[role=tab]:has-text('Hasil')");
        await a.page.selectOption("#panel-hasil select[name=decision]", "APPROVE");
        const t = await a.page.locator("#panel-hasil").innerText();
        if (!t.includes("Enhanced belum dapat disetujui") || !t.includes("Lengkapi checklist")) throw new Error("Setujui Enhanced nonaktif tanpa alasan: " + t.slice(0, 300));
        if (!(await a.page.locator("#panel-hasil button:text-is('Simpan keputusan')").isDisabled())) throw new Error("Simpan keputusan aktif padahal syarat Enhanced belum lengkap");
      }
    });

    await step(tag(`@${w.width}px admin: semua halaman admin (navigasi lengkap, tanpa overflow, target sentuh, tanpa error konsol)`), async () => {
      const a = await open("admin", w);
      await checkPage(a, w, "/admin", { markers: ["Dashboard Admin Platform"] });
      for (const href of ADMIN_PAGES) {
        if (!(await a.page.locator(`nav a[href='${href}']`).count())) throw new Error(`navigasi admin tanpa ${href}`);
      }
      if (w.width < 1280) {
        await a.page.click("summary:has-text('Menu')");
        if (!(await a.page.locator("header nav a[href='/admin/payments']").isVisible())) throw new Error("menu HP admin tidak membuka daftar modul");
        if ((await overflow(a.page)) > 1) throw new Error("menu HP admin meluap");
      }
      for (const href of ADMIN_PAGES.slice(1)) await checkPage(a, w, href);
    });
  }

  await step(tag("konfirmasi akhir Review Standar menyebut versi, hash, hasil, catatan, lingkup; Kembali tidak menerbitkan"), async () => {
    const a = await open("reviewer", WIDTHS[1]);
    await a.page.goto(base + `/partner/reviews/${req1}`);
    await a.page.fill("textarea[name=scope]", "Kepatutan klausul kerahasiaan");
    await submit(a.page, a.page.locator("button:has-text('Simpan draf')"));
    await a.page.check("input[name=noNotesDeclared]");
    await a.page.check("input[name=attest]");
    await a.page.click("button:has-text('Terbitkan hasil')");
    const dlg = a.page.locator("dialog[open]");
    await dlg.waitFor();
    const t = await dlg.innerText();
    for (const m of ["Versi 1", sha1, "Tanpa Legal Note", "Kepatutan klausul kerahasiaan", "Catatan yang belum diselesaikan pemilik", "Tidak ada"]) if (!t.includes(m)) throw new Error(`konfirmasi tanpa "${m}": ${t.slice(0, 400)}`);
    await dlg.locator("button:has-text('Kembali memeriksa')").click();
    await dlg.waitFor({ state: "detached" }).catch(() => {});
    if (await a.page.locator("dialog[open]").count()) throw new Error("dialog tidak tertutup");
    const st = (await db.query("select status from review_requests where id = $1", [req1])).rows[0].status;
    if (st !== "IN_REVIEW") throw new Error("Kembali memeriksa ikut menerbitkan: " + st);
    if (a.issues.length) throw new Error("error konsol: " + a.issues.join(" | "));
  });

  for (const c of contexts) await c.close();
}

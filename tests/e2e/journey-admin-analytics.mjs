// Analitik admin (Task 7): data sintetis disiapkan lewat DB pada hari WIB tertentu → admin melihat grafik tren,
// filter jenis dokumen/keanggotaan dan rentang khusus mengubah angka, rentang salah menampilkan pesan jelas,
// 375px tanpa overflow + target sentuh >= 43.5px + tanpa error konsol, judul dokumen tidak tampil, dan non-admin ditolak.
import { register } from "./helpers.mjs";

export const onlyViewport = "desktop";
const HP = { name: "hp", width: 375, height: 800 };
const SECRET_TITLE = "RAHASIA-JUDUL-ANALITIK";

const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const smallTargets = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("a[href], button, input:not([type=hidden]):not([type=checkbox]), select, textarea, summary")]
      .filter((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && !e.closest("[aria-hidden=true]") && !e.closest("nextjs-portal") && r.height < 43.5; })
      .map((e) => `${e.tagName.toLowerCase()}:${(e.textContent || e.getAttribute("name") || "").trim().slice(0, 24)}:${Math.round(e.getBoundingClientRect().height)}px`),
  );
const kpi = (page, label) =>
  page.evaluate((l) => {
    const card = [...document.querySelectorAll("[data-testid=kpi] > div")].find((d) => d.querySelector("p")?.textContent === l);
    return card ? { value: card.querySelectorAll("p")[1].textContent, hint: card.querySelectorAll("p")[2]?.textContent ?? "" } : null;
  }, label);

export async function journey({ step, base, db, newActor }) {
  const n = Date.now();
  const mail = (who) => `analitik-${who}+${n}@example.com`;
  const tag = (s) => `[analitik] ${s}`;
  const actors = { admin: await newActor("analitik-admin"), biasa: await newActor("analitik-biasa") };
  const browser = actors.admin.page.context().browser();
  const ids = {};
  // Rentang lampau tetap agar tidak bercampur dengan data perjalanan lain (yang terjadi hari ini).
  const D = ["2026-09-01", "2026-09-02", "2026-09-03"];
  const at = (day, hhmm) => new Date(`${day}T${hhmm}:00+07:00`);

  await step(tag("siapkan: admin + pengguna biasa lewat pendaftaran; dokumen sintetis per hari WIB lewat DB (Gratis vs Member, NDA vs PKS)"), async () => {
    for (const who of Object.keys(actors)) {
      await register(actors[who].page, base, mail(who));
      ids[who] = (await db.query("select id from auth.users where email = $1", [mail(who)])).rows[0].id;
    }
    await db.query("insert into public.user_roles (user_id, role) values ($1, 'platform_admin') on conflict do nothing", [ids.admin]);
    const mk = async (email) => (await db.query("insert into auth.users (email) values ($1) returning id", [email])).rows[0].id;
    const free = await mk(`analitik-gratis+${n}@example.com`);
    const member = await mk(`analitik-member+${n}@example.com`);
    await db.query("insert into memberships (user_id, status, period_start, period_end) values ($1, 'ACTIVE', '2026-08-01T00:00:00+07:00', '2026-12-01T00:00:00+07:00')", [member]);
    const doc = (owner, cat, when) => db.query(
      "insert into documents (owner_id, category, template_id, template_version, title, idempotency_key, created_at) values ($1, $2, $3, 1, $4, $5, $6)",
      [owner, cat, cat.toLowerCase(), SECRET_TITLE, `e2e-analitik-${Math.random()}`, when]);
    // 1 Sep: 2 NDA gratis (salah satunya 23.59 WIB). 2 Sep: 1 PKS member (00.00 WIB). 3 Sep: 3 NDA member.
    await doc(free, "NDA", at(D[0], "09:00"));
    await doc(free, "NDA", at(D[0], "23:59"));
    await doc(member, "PKS", at(D[1], "00:00"));
    for (let i = 0; i < 3; i++) await doc(member, "NDA", at(D[2], "10:0" + i));
  });

  const open = async (w) => {
    const ctx = await browser.newContext({ viewport: { width: w.width, height: w.height }, storageState: await actors.admin.page.context().storageState() });
    const page = await ctx.newPage();
    const issues = [];
    page.on("console", (m) => { if (m.type() === "error") issues.push(m.text().slice(0, 500)); });
    page.on("pageerror", (e) => issues.push(`pageerror: ${e.message}`.slice(0, 500)));
    return { ctx, page, issues };
  };
  const apply = async (page) => {
    await Promise.all([page.waitForURL(/\/admin\/analytics\?/), page.click("button:has-text('Terapkan')")]);
    await page.waitForLoadState("networkidle");
  };
  const docs = async (page) => (await kpi(page, "Dokumen dimulai"))?.value;

  await step(tag("admin: rentang khusus 1–3 Sep menampilkan grafik tren, total 6 dokumen, pembanding periode, tanpa judul dokumen"), async () => {
    const a = await open({ width: 1280, height: 800 });
    try {
      const r = await a.page.goto(base + `/admin/analytics?dari=${D[0]}&sampai=${D[2]}`);
      if (r.status() !== 200) throw new Error("status " + r.status());
      if ((await docs(a.page)) !== "6") throw new Error("Dokumen dimulai bukan 6: " + (await docs(a.page)));
      const hint = (await kpi(a.page, "Dokumen dimulai")).hint;
      if (!/periode sebelumnya/i.test(hint)) throw new Error("tanpa perbandingan periode: " + hint);
      const charts = await a.page.locator("figure svg[role=img]").count();
      if (charts < 6) throw new Error("grafik tren kurang: " + charts);
      const label = await a.page.locator("figure:has-text('Dokumen dimulai per hari') svg").getAttribute("aria-label");
      if (!label.includes("total 6") || !label.includes("3 hari")) throw new Error("label grafik: " + label);
      const body = await a.page.innerText("body");
      if (body.includes(SECRET_TITLE)) throw new Error("judul dokumen tampil di analitik");
      if (/\bcap\b/i.test(body)) throw new Error('kata "cap" muncul');
      if (!body.includes("Kualitas") || !body.includes("Peringatan")) throw new Error("panel kualitas/peringatan hilang");
      if (a.issues.length) throw new Error("error konsol: " + a.issues.join(" | "));
    } finally { await a.ctx.close(); }
  });

  await step(tag("admin: filter jenis (NDA) dan keanggotaan (Member) lewat form mengubah angka; rentang satu hari mengubah angka"), async () => {
    const a = await open({ width: 1280, height: 800 });
    try {
      await a.page.goto(base + `/admin/analytics?dari=${D[0]}&sampai=${D[2]}`);
      await a.page.selectOption("select[name=jenis]", "NDA");
      await apply(a.page);
      if ((await docs(a.page)) !== "5") throw new Error("NDA bukan 5: " + (await docs(a.page)));
      if (!(await a.page.innerText("[data-testid=range-status]")).includes("Perjanjian Kerahasiaan")) throw new Error("status filter tidak menyebut jenis");
      await a.page.selectOption("select[name=anggota]", "MEMBER");
      await apply(a.page);
      if ((await docs(a.page)) !== "3") throw new Error("NDA+Member bukan 3: " + (await docs(a.page)));
      if ((await kpi(a.page, "Pengguna baru")).value !== "Belum ada data") throw new Error("pengguna baru seharusnya tidak berlaku untuk filter jenis");
      await a.page.selectOption("select[name=jenis]", "");
      await a.page.selectOption("select[name=anggota]", "");
      await a.page.fill("input[name=dari]", D[1]);
      await a.page.fill("input[name=sampai]", D[1]);
      await apply(a.page);
      if ((await docs(a.page)) !== "1") throw new Error("2 Sep bukan 1 (batas 00.00 WIB): " + (await docs(a.page)));
      await a.page.fill("input[name=dari]", D[0]);
      await a.page.fill("input[name=sampai]", D[0]);
      await apply(a.page);
      if ((await docs(a.page)) !== "2") throw new Error("1 Sep bukan 2 (23.59 WIB masuk): " + (await docs(a.page)));
    } finally { await a.ctx.close(); }
  });

  await step(tag("admin: rentang terbalik menampilkan pesan jelas dan tanggal ketikan tetap terisi"), async () => {
    const a = await open({ width: 1280, height: 800 });
    try {
      await a.page.goto(base + "/admin/analytics");
      await a.page.fill("input[name=dari]", D[2]);
      await a.page.fill("input[name=sampai]", D[0]);
      await apply(a.page);
      const alert = await a.page.locator("main [role=alert]").innerText();
      if (!alert.includes("Tanggal akhir tidak boleh sebelum tanggal awal")) throw new Error("pesan galat: " + alert);
      if ((await a.page.inputValue("input[name=dari]")) !== D[2]) throw new Error("tanggal ketikan hilang");
      if (a.issues.length) throw new Error("error konsol: " + a.issues.join(" | "));
    } finally { await a.ctx.close(); }
  });

  await step(tag("@375px /admin/analytics: tanpa overflow, target sentuh >= 43.5px, tanpa error konsol"), async () => {
    const a = await open(HP);
    try {
      await a.page.goto(base + `/admin/analytics?dari=${D[0]}&sampai=${D[2]}&jenis=NDA`);
      await a.page.waitForLoadState("networkidle");
      await a.page.locator("summary:has-text('Lihat angka per hari')").first().click();
      const over = await overflow(a.page);
      if (over > 1) throw new Error(`meluap ${over}px`);
      const bad = await smallTargets(a.page);
      if (bad.length) throw new Error("target kecil: " + bad.slice(0, 6).join(" | "));
      if (a.issues.length) throw new Error("error konsol: " + a.issues.join(" | "));
      await a.page.screenshot({ path: `${process.env.SHOTS_DIR ?? "/tmp/yk-shots"}/analitik-hp.png`, fullPage: true }).catch(() => {});
    } finally { await a.ctx.close(); }
  });

  await step(tag("pengguna biasa ditolak di /admin/analytics"), async () => {
    const p = actors.biasa.page;
    await p.goto(base + "/admin/analytics");
    await p.waitForLoadState("networkidle");
    if (new URL(p.url()).pathname.startsWith("/admin")) throw new Error("pengguna biasa tetap di " + p.url());
    if ((await p.innerText("body")).includes("Analitik dan tren")) throw new Error("isi analitik tampil untuk non-admin");
  });
}

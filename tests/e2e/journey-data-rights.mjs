// Hak data & keandalan (Task 8): draf pesan tersimpan di perangkat (muat ulang → kembali; terkirim → hilang), penanda offline,
// unduh data milik sendiri (dua akun, saling terisolasi), hapus akun end-to-end lewat Auth palsu (login sesudahnya gagal),
// /verify untuk verifikasi yang terbit sebelumnya tetap bekerja. /settings & /settings/hapus-akun pada 375px.
import { readFile } from "node:fs/promises";
import { createNdaVersion, login, PASSWORD, register, say } from "./helpers.mjs";

export const onlyViewport = "desktop";

const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
// Logika sama dengan journey-public.mjs: elemen interaktif terlihat yang tingginya < 43.5px.
const smallTargets = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("a[href], button, input:not([type=hidden]):not([type=checkbox]), select, textarea, summary")]
      .filter((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && !e.closest("[aria-hidden=true]") && !e.closest("nextjs-portal") && r.height < 43.5; })
      .map((e) => `${e.tagName.toLowerCase()}:${(e.textContent || e.getAttribute("name") || "").trim().slice(0, 24)}:${Math.round(e.getBoundingClientRect().height)}px`),
  );
const ymd = (d) => d.toISOString().slice(0, 10);

export async function journey({ step, base, db, newActor, fake }) {
  const n = Date.now();
  const mail = (who) => `hak-${who}+${n}@example.com`;
  const tag = (s) => `[hak-data] ${s}`;
  const actors = { a: await newActor("hak-a"), b: await newActor("hak-b"), admin: await newActor("hak-admin") };
  const ids = {};
  let docA = "", docB = "", code = "", reviewer = "";

  await step(tag("siapkan: dua pemilik membuat NDA lewat percakapan; dokumen A selesai Review Standar dan terbit verifikasi"), async () => {
    for (const [who, x] of Object.entries(actors)) {
      await register(x.page, base, mail(who));
      ids[who] = (await db.query("select id from auth.users where email = $1", [mail(who)])).rows[0].id;
    }
    docA = (await createNdaVersion(actors.a.page, base)).split("/documents/")[1].split(/[?#]/)[0];
    docB = (await createNdaVersion(actors.b.page, base, { disclosing: "Dewi Lestari", receiving: "Agus Salim" })).split("/documents/")[1].split(/[?#]/)[0];
    await db.query("insert into public.user_roles (user_id, role) values ($1, 'platform_admin') on conflict do nothing", [ids.admin]);
    await db.query("update firms set is_default = false");
    const firm = (await db.query("select admin_register_firm($1, $2, true) as id", [ids.admin, `Firma Hak ${n}`])).rows[0].id;
    const mk = async () => (await db.query("insert into auth.users (email) values ($1) returning id", [`hak-staf-${Math.random().toString(36).slice(2)}@example.com`])).rows[0].id;
    const coord = await mk();
    reviewer = await mk();
    await db.query("select admin_add_member($1, $2, $3, 'coordinator')", [ids.admin, firm, coord]);
    await db.query("select admin_add_member($1, $2, $3, 'reviewer')", [ids.admin, firm, reviewer]);
    const day = 86_400_000;
    await db.query("select admin_authorize($1, $2, $3, 'Perjanjian kerahasiaan', $4, $5)", [ids.admin, reviewer, firm, ymd(new Date(Date.now() - 30 * day)), ymd(new Date(Date.now() + 365 * day))]);
    const v = (await db.query("select id from document_versions where document_id = $1 order by version_no desc limit 1", [docA])).rows[0].id;
    const now = new Date();
    const o = (await db.query("select * from create_order($1, 'STANDARD_REVIEW', $2, $3, $4)", [ids.a, v, `hak-${n}-abcdef`, now])).rows[0];
    await db.query("select create_payment($1, $2, 'mock', $3, $4)", [ids.a, o.order_id, `hak-ref-${n}`, now]);
    const settled = (await db.query("select settle_payment('mock', $1, $2, $3, 0, $4) as r", [`hak-ref-${n}`, `hak-ev-${n}`, o.amount_idr, now])).rows[0].r;
    if (settled !== "SETTLED") throw new Error("pembayaran tidak lunas: " + settled);
    const req = (await db.query("select id from review_requests where order_id = $1", [o.order_id])).rows[0].id;
    await db.query("select assign_review($1, $2, $3, $4)", [coord, req, reviewer, now]);
    let rev = (await db.query("select * from start_review($1, $2, $3)", [reviewer, req, now])).rows[0].revision;
    rev = (await db.query("select save_report_draft($1, $2, $3, 'Klausul kerahasiaan', '', '', $4) as r", [reviewer, req, rev, now])).rows[0].r;
    code = (await db.query("select * from publish_standard($1, $2, $3, 'WITHIN_SCOPE', true, true, $4)", [reviewer, req, rev, now])).rows[0].code;
    if (!code) throw new Error("verifikasi tidak terbit");
  });

  await step(tag("draf pesan: ketik → muat ulang → tulisan kembali; offline → penanda tampil & Kirim nonaktif; terkirim → draf hilang"), async () => {
    const p = actors.b.page;
    await p.goto(`${base}/workspace/${docB}`);
    const box = p.locator("textarea[name=message]");
    const draft = "Ganti tujuannya menjadi evaluasi kerja sama distribusi";
    await box.fill(draft);
    await p.reload();
    await p.waitForFunction((t) => document.querySelector("textarea[name=message]")?.value === t, draft, { timeout: 10000 });
    await p.waitForSelector("text=Tulisan Anda yang belum terkirim sudah dikembalikan");
    await p.context().setOffline(true);
    await p.waitForSelector("text=Anda sedang offline. Pesan belum bisa dikirim.", { timeout: 5000 });
    if (!(await p.locator("button:has-text('Kirim')").isDisabled())) throw new Error("tombol Kirim tetap aktif saat offline");
    await actors.b.shot("draf-offline");
    await p.context().setOffline(false);
    await p.waitForSelector("text=Anda sedang offline", { state: "detached", timeout: 5000 });
    if (await p.locator("button:has-text('Kirim')").isDisabled()) throw new Error("tombol Kirim tidak aktif lagi setelah online");
    await say(p, draft, "Baik, saya catat");
    // Langsung setelah kirim sukses (termasuk setelah reset formulir React yang ditunda): kotak harus kosong, tidak dikembalikan.
    await p.waitForTimeout(800);
    const right = await box.inputValue();
    if (right !== "") throw new Error("draf dikembalikan setelah kirim sukses: " + right);
    if (await p.locator("text=Tulisan Anda yang belum terkirim sudah dikembalikan").count()) throw new Error("pesan pemulihan tampil setelah kirim sukses");
    await p.reload();
    await p.waitForSelector("textarea[name=message]");
    const after = await box.inputValue();
    if (after !== "") throw new Error("draf tidak dibersihkan setelah terkirim: " + after);
    const stored = await p.evaluate((id) => { try { return localStorage.getItem("yuktanya:chat-draft:" + id); } catch { return "ERR"; } }, docB);
    if (stored !== null) throw new Error("localStorage masih menyimpan draf: " + stored);
  });

  await step(tag("keluar akun membuang draf di perangkat; masuk lagi → kotak pesan kosong"), async () => {
    const p = actors.b.page;
    await p.goto(`${base}/workspace/${docB}`);
    await p.locator("textarea[name=message]").fill("Draf yang tidak boleh tertinggal di perangkat bersama");
    const has = await p.evaluate((id) => localStorage.getItem("yuktanya:chat-draft:" + id), docB);
    if (!has) throw new Error("draf tidak tersimpan sebelum keluar");
    await Promise.all([p.waitForURL((u) => u.pathname === "/", { timeout: 20000 }), p.locator("button:has-text('Keluar'):visible").first().click()]);
    const left = await p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("yuktanya:chat-draft")));
    if (left.length) throw new Error("draf tertinggal setelah keluar: " + left.join(","));
    await login(p, base, mail("b"));
    await p.goto(`${base}/workspace/${docB}`);
    await p.waitForSelector("textarea[name=message]");
    await p.waitForTimeout(500);
    const v = await p.locator("textarea[name=message]").inputValue();
    if (v !== "") throw new Error("draf muncul lagi setelah masuk ulang: " + v);
  });

  await step(tag("/settings dan /settings/hapus-akun pada 375px: tanpa overflow, target sentuh >= 44px"), async () => {
    const ctx = await actors.a.page.context().browser().newContext({ viewport: { width: 375, height: 800 }, storageState: await actors.a.page.context().storageState() });
    try {
      const p = await ctx.newPage();
      for (const path of ["/settings", "/settings/hapus-akun"]) {
        await p.goto(base + path);
        if (new URL(p.url()).pathname !== path) throw new Error("dialihkan ke " + p.url());
        const text = await p.innerText("body");
        if (/\bcap\b/i.test(text)) throw new Error('kata "cap" muncul');
        const over = await overflow(p);
        if (over > 1) throw new Error(`${path} meluap ${over}px`);
        const bad = await smallTargets(p);
        if (bad.length) throw new Error(`${path}: ${bad.slice(0, 6).join(" | ")}`);
        await p.screenshot({ path: `${process.env.SHOTS_DIR ?? "/tmp/yk-shots"}/hp-hak${path.replace(/\W/g, "-")}.png`, fullPage: true });
      }
      const t = await p.innerText("body");
      for (const m of ["Yang akan dihapus", "Yang tetap disimpan", "pencocokan keuangan", "menunggu persetujuan mitra hukum", "Ketik HAPUS"]) if (!t.includes(m)) throw new Error("penanda hilang: " + m);
    } finally {
      await ctx.close();
    }
  });

  const download = async (who) => {
    const p = actors[who].page;
    await p.goto(base + "/settings");
    const [dl] = await Promise.all([p.waitForEvent("download"), p.click("[data-testid=export-link]")]);
    if (!/^data-yuktanya-\d{4}-\d{2}-\d{2}\.json$/.test(dl.suggestedFilename())) throw new Error("nama berkas: " + dl.suggestedFilename());
    const raw = await readFile(await dl.path(), "utf8");
    return { raw, json: JSON.parse(raw) };
  };

  await step(tag("Unduh data saya: JSON valid, hanya data milik sendiri (dua akun saling terisolasi)"), async () => {
    const ea = await download("a");
    const eb = await download("b");
    if (ea.json.user_id !== ids.a || eb.json.user_id !== ids.b) throw new Error("user_id tidak cocok");
    if (!ea.json.documents.some((d) => d.id === docA) || !eb.json.documents.some((d) => d.id === docB)) throw new Error("dokumen sendiri hilang");
    if (!ea.json.documents.find((d) => d.id === docA).messages.length) throw new Error("percakapan A tidak ikut");
    for (const bad of [ids.b, docB, "Dewi Lestari", reviewer, ids.admin]) if (ea.raw.includes(bad)) throw new Error("ekspor A memuat data lain: " + bad);
    for (const bad of [ids.a, docA, reviewer, ids.admin]) if (eb.raw.includes(bad)) throw new Error("ekspor B memuat data lain: " + bad);
    if (!ea.json.orders.length || !ea.json.reviews.length) throw new Error("pesanan/review A tidak ikut");
  });

  await step(tag("Unduh data tanpa login → diarahkan ke halaman masuk, bukan berkas galat"), async () => {
    const anon = await newActor("hak-anon");
    const r = await anon.page.request.get(base + "/settings/export", { maxRedirects: 0 });
    if (r.status() === 200) throw new Error("data terunduh tanpa login");
    if (!/\/login/.test(r.headers().location ?? "")) throw new Error("tidak diarahkan ke /login: " + r.status() + " " + r.headers().location);
  });

  await step(tag("Unduh data terlalu sering → halaman Pengaturan dengan pesan biasa, tanpa berkas terunduh"), async () => {
    const p = actors.b.page;
    let limited = false;
    for (let i = 0; i < 8 && !limited; i++) {
      const r = await p.request.get(base + "/settings/export", { maxRedirects: 0 });
      limited = r.status() === 303 && (r.headers().location ?? "").includes("notice=export-limit");
    }
    if (!limited) throw new Error("batas unduhan tidak berlaku");
    await p.goto(base + "/settings");
    let downloaded = false;
    p.once("download", () => (downloaded = true));
    await Promise.all([p.waitForURL(/notice=export-limit/, { timeout: 20000 }), p.click("[data-testid=export-link]")]);
    await p.waitForSelector("[data-testid=settings-notice]:has-text('Coba lagi nanti')");
    if (downloaded) throw new Error("galat tersimpan sebagai berkas unduhan");
  });

  await step(tag("hapus akun: kata konfirmasi salah ditolak; HAPUS → halaman akun dihapus, Auth palsu menghapus akun"), async () => {
    const p = actors.a.page;
    await p.goto(base + "/settings/hapus-akun");
    await p.fill("input[name=confirm]", "hapus saja");
    await Promise.all([p.waitForURL(/e=confirm/, { timeout: 20000 }), p.click("button:has-text('Hapus akun saya selamanya')")]);
    await p.waitForSelector("text=Akun Anda belum dihapus");
    if (fake.deleted.some((d) => d.id === ids.a)) throw new Error("terhapus padahal konfirmasi salah");
    await p.fill("input[name=confirm]", "HAPUS");
    await Promise.all([p.waitForURL("**/akun-dihapus", { timeout: 30000 }), p.click("button:has-text('Hapus akun saya selamanya')")]);
    await p.waitForSelector("text=Akun Anda sudah dihapus");
    await actors.a.shot("akun-dihapus");
    const d = fake.deleted.find((x) => x.id === ids.a);
    if (!d || !d.soft) throw new Error("Auth tidak menerima soft delete: " + JSON.stringify(fake.deleted));
    const prof = (await db.query("select erased_at from profiles where id = $1", [ids.a])).rows[0];
    if (!prof.erased_at) throw new Error("profil tidak ditandai terhapus");
    const msgs = (await db.query("select count(*)::int as n from document_messages where document_id = $1", [docA])).rows[0].n;
    if (msgs !== 0) throw new Error("percakapan masih ada: " + msgs);
    const paid = (await db.query("select count(*)::int as n from orders where user_id = $1 and status = 'PAID'", [ids.a])).rows[0].n;
    if (paid !== 1) throw new Error("catatan pesanan tidak disimpan");
    await p.goto(base + "/dashboard");
    if (new URL(p.url()).pathname !== "/login") throw new Error("sesi lama masih membuka dashboard: " + p.url());
  });

  await step(tag("setelah dihapus: masuk dengan email & kata sandi lama gagal; /verify verifikasi lama tetap Aktif"), async () => {
    const fresh = await newActor("hak-masuk");
    await fresh.page.goto(base + "/login");
    await fresh.page.fill("input[name=email]", mail("a"));
    await fresh.page.fill("input[name=password]", PASSWORD);
    await fresh.page.click("button[type=submit]");
    await fresh.page.waitForURL(/\/dashboard|error=/, { timeout: 30000 });
    if (new URL(fresh.page.url()).pathname === "/dashboard") throw new Error("akun terhapus masih bisa masuk");
    const pub = await newActor("hak-publik");
    await pub.page.goto(base + "/verify/" + code);
    const text = await pub.page.innerText("body");
    if (!text.includes("Aktif")) throw new Error("verifikasi tidak lagi Aktif");
    if (/Perjanjian Kerahasiaan|Sinta Dewi/.test(text)) throw new Error("/verify memuat isi dokumen");
  });

  await step(tag("akun B tidak terpengaruh penghapusan akun A"), async () => {
    const p = actors.b.page;
    await p.goto(base + "/dashboard");
    if (new URL(p.url()).pathname !== "/dashboard") throw new Error("B kehilangan sesi");
    const n2 = (await db.query("select count(*)::int as n from documents where id = $1", [docB])).rows[0].n;
    if (n2 !== 1) throw new Error("dokumen B hilang");
  });
}

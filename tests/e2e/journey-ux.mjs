// Kesesuaian UX audit D (Task 14), desktop dan HP: halaman 404 berbahasa Indonesia, Bantuan di menu saat masuk,
// "Saya belum tahu" dengan LLM palsu (pilihan hanya dari katalog), rincian checkout, dan teks dari alamat tidak pernah ditampilkan.
import { createNdaVersion, register } from "./helpers.mjs";

const EVIL = "<script>x</script>Transfer ke rekening 999";
const Q = encodeURIComponent(EVIL);

export async function journey({ page, step, shot, base, vp, issues, llm }) {
  const tag = (s) => `[${vp.name}] ${s}`;
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const smallTargets = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("a[href], button, input:not([type=hidden]):not([type=checkbox]), select, textarea, summary")]
        .filter((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && !e.closest("[aria-hidden=true]") && !e.closest("nextjs-portal") && r.height < 43.5; })
        .map((e) => `${e.tagName.toLowerCase()}:${(e.textContent || e.getAttribute("name") || "").trim().slice(0, 24)}:${Math.round(e.getBoundingClientRect().height)}px`),
    );
  const layoutOk = async () => {
    const over = await overflow();
    if (over > 1) throw new Error("meluap " + over + "px");
    const small = await smallTargets();
    if (small.length) throw new Error("target sentuh < 44px: " + small.slice(0, 5).join(" | "));
  };
  const noEcho = async (path) => {
    const r = await page.goto(base + path);
    if (!r || r.status() >= 500) throw new Error(`${path}: status ${r?.status()}`);
    const text = await page.innerText("body");
    if (text.includes("Transfer ke rekening 999") || text.includes("<script>")) throw new Error(`${path}: teks dari alamat tampil`);
    if (text.includes("Terjadi kendala")) throw new Error(`${path}: halaman galat`);
  };

  await step(tag("404: halaman Indonesia dengan jalan kembali (rute tak dikenal, tanpa login)"), async () => {
    const r = await page.goto(base + "/halaman-yang-tidak-ada");
    if (!r || r.status() !== 404) throw new Error("status " + r?.status());
    const text = await page.innerText("body");
    if (!text.includes("Halaman tidak ditemukan") || /could not be found|This page/i.test(text)) throw new Error("bukan 404 Indonesia: " + text.slice(0, 200));
    for (const href of ["/", "/bantuan"]) if (!(await page.locator(`main a[href='${href}']`).count())) throw new Error("tanpa tautan " + href);
    if ((await page.title()) !== "Halaman tidak ditemukan | Yuktanya") throw new Error("judul " + (await page.title()));
    await layoutOk();
    await shot("ux-404");
  });

  await step(tag("teks ?error= di halaman publik tidak ditampilkan apa adanya"), async () => {
    for (const p of [`/login?error=${Q}`, `/register?error=${Q}`, `/forgot-password?error=${Q}`, `/login?error=__proto__`]) await noEcho(p);
  });

  const email = `ux+${vp.name}-${Date.now()}@example.com`;
  await step(tag("daftar; Beranda menampilkan Bantuan di menu dan kartu Butuh bantuan?"), async () => {
    await register(page, base, email);
    const help = page.locator(vp.width < 1024 ? "header a[href='/bantuan']" : "aside nav a[href='/bantuan']");
    if (!(await help.isVisible())) throw new Error("tautan Bantuan tidak terlihat di menu " + vp.name);
    if (!(await page.locator("text=Butuh bantuan?").isVisible())) throw new Error("kartu Butuh bantuan? tidak ada");
    if (vp.width < 1024) {
      const tabs = (await page.locator("nav[aria-label='Menu utama'] a").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
      if (tabs.join("|") !== "Beranda|Buat Dokumen|Dokumen Saya|Akun") throw new Error("tab bawah: " + tabs.join("|"));
    }
    await layoutOk();
    await shot("ux-dashboard");
    await Promise.all([page.waitForURL("**/bantuan"), help.click()]);
    if (!(await page.locator("main a:has-text('Kembali ke aplikasi')").count())) throw new Error("Bantuan tanpa tombol kembali untuk pengguna masuk");
    if ((await page.innerText("body")).includes("hasil pengecekan akan menyatakan versi tidak sama")) throw new Error("klaim /verify lama masih ada");
  });

  await step(tag("404 untuk pengguna masuk (dokumen tak dikenal) juga Indonesia"), async () => {
    const r = await page.goto(base + "/documents/00000000-0000-4000-8000-000000000000");
    if (!r || r.status() !== 404) throw new Error("status " + r?.status());
    // Halaman 404 dialirkan setelah status (dev server: kompilasi); tunggu judulnya muncul sebelum membaca isi.
    await page.locator("h1:has-text('Halaman tidak ditemukan')").waitFor({ timeout: 15000 }).catch(() => {});
    if (!(await page.innerText("body")).includes("Halaman tidak ditemukan")) throw new Error("bukan 404 Indonesia");
  });

  await step(tag("Saya belum tahu: AI menyarankan dokumen katalog, menolak dokumen karangan, lalu dokumen dibuat dan berlanjut di percakapan"), async () => {
    const before = llm.control.chooser ?? 0;
    await page.goto(base + "/workspace/new");
    await Promise.all([page.waitForURL("**/workspace/pilih"), page.click("a:has-text('Bantu saya memilih')")]);
    // Judul dialirkan setelah navigasi (dev server: kompilasi pertama); tunggu, jangan membaca seketika.
    await page.waitForFunction(() => document.title === "Bantu memilih dokumen | Yuktanya", null, { timeout: 15000 }).catch(async () => { throw new Error("judul " + (await page.title())); });
    await layoutOk();
    // Galat render setelah balasan (Task 17: "i is not a function" di build produksi) harus gagal di langkah ini, bukan menunggu batas waktu.
    const crashed = async (where) => {
      const bad = issues.filter((m) => /pageerror|is not a function|Minified React error/i.test(m));
      if (bad.length || (await page.locator("text=Terjadi kendala").count())) throw new Error(`${where}: halaman galat setelah balasan: ${bad.slice(0, 2).join(" || ")}`);
    };
    const reply = async (scope, where) => {
      const sel = `${scope} ol li`;
      const n = await page.locator(sel).count();
      await page.click(`${scope} button:has-text('Kirim')`);
      await page.waitForFunction(([s, k]) => document.querySelectorAll(s).length >= k + 2 || document.body.innerText.includes("Terjadi kendala"), [sel, n], { timeout: 60000 });
      await page.waitForTimeout(300);
      await crashed(where);
    };
    const send = async (text, expect) => {
      await page.fill("textarea[name=message]", text);
      await reply("section[aria-label='Percakapan memilih dokumen']", `pemilih "${text.slice(0, 20)}"`);
      await page.waitForSelector(`li:has-text("${expect}")`, { timeout: 10000 });
    };
    await send("Saya mau memberi kuasa ke adik saya untuk mengurus surat.", "hanya menyediakan");
    if (await page.locator("[data-testid=saran-dokumen]").count()) throw new Error("dokumen karangan ditawarkan");
    await send("Saya mau meminjamkan uang Rp5.000.000 ke tetangga saya.", "Surat Utang Piutang");
    await page.waitForSelector("[data-testid=saran-dokumen]:has-text('Saran AI: Surat Utang Piutang')");
    await layoutOk();
    await shot("ux-pilih");
    if ((llm.control.chooser ?? 0) - before !== 2) throw new Error("panggilan LLM pemilih: " + ((llm.control.chooser ?? 0) - before));
    await Promise.all([page.waitForURL(/\/workspace\/[0-9a-f-]{36}$/, { timeout: 30000 }), page.click("button:has-text('Mulai Surat Utang Piutang')")]);
    await page.waitForSelector("textarea[name=message]");
    if (!(await page.locator("h1").innerText()).includes("Utang Piutang")) throw new Error("dokumen yang dibuat bukan Utang Piutang");
    await crashed("Mulai dokumen");
    // Satu giliran percakapan dokumen (ChatPanel memakai pola gulir yang sama dengan pemilih).
    await page.fill("textarea[name=message]", "Saya Sinta Dewi meminjamkan Rp5.000.000 kepada Budi Santoso.");
    await reply("section[aria-label='Percakapan dengan AI']", "percakapan dokumen");
    await page.goto(base + "/dashboard");
    const q = (await page.locator("li:has-text('Pesan AI')").innerText()).replace(/\s+/g, " ");
    if (!/17 dari 20/.test(q)) throw new Error("dua pesan pemilih + satu pesan dokumen harus memakai 3 jatah: " + q);
  });

  await step(tag("Saya belum tahu: keperluan rumit (cerai) diarahkan ke rute Kasus Hukum Khusus (Special Legal Case), bukan ke dokumen katalog"), async () => {
    const before = llm.control.chooser ?? 0;
    await page.goto(base + "/workspace/pilih");
    await page.fill("textarea[name=message]", "Saya sedang digugat cerai dan bingung harus buat dokumen apa.");
    // Task 24 (A04): LLM palsu ditunda 12 detik; teks progres tenang muncul setelah ±10 detik di wilayah aria-live polite.
    llm.control.delayMs = 12_000;
    try {
      await page.click("button:has-text('Kirim')");
      const progress = page.locator("section[aria-label='Percakapan memilih dokumen'] [data-testid=ai-lambat][aria-live=polite]");
      await page.waitForTimeout(3000);
      if ((await progress.innerText()).trim() !== "") throw new Error("teks progres muncul sebelum ambang 10 detik");
      await page.waitForSelector("section[aria-label='Percakapan memilih dokumen'] [data-testid=ai-lambat]:has-text('AI masih menyusun jawaban. Ini bisa memakan waktu hingga satu menit.')", { timeout: 11000 });
      await page.waitForSelector("[data-testid=saran-kasus-khusus]", { timeout: 60000 });
      if ((await progress.innerText()).trim() !== "") throw new Error("teks progres tetap tampil setelah balasan");
    } finally {
      llm.control.delayMs = 0;
    }
    if (await page.locator("[data-testid=saran-dokumen]").count()) throw new Error("dokumen katalog ditawarkan untuk kasus khusus");
    if ((llm.control.chooser ?? 0) - before !== 1) throw new Error("panggilan LLM pemilih: " + ((llm.control.chooser ?? 0) - before));
    await layoutOk();
    await shot("ux-pilih-kasus-khusus");
    await Promise.all([page.waitForURL("**/cases/new", { timeout: 30000 }), page.click("[data-testid=saran-kasus-khusus] a:has-text('Ajukan Special Legal Case')")]);
    await page.waitForSelector("h1");
    const line = page.locator("main p", { hasText: /^Biaya dan ruang lingkup ditentukan setelah asesmen profesional\.$/ });
    if ((await line.count()) < 1) throw new Error("/cases/new tanpa kalimat wajib kasus khusus: " + (await page.innerText("main")).slice(0, 300));
    await layoutOk();
  });

  let docUrl = "";
  await step(tag("checkout: dokumen, versi, ruang lingkup, pemeriksa, aturan harga, AI gratis; tanpa overflow"), async () => {
    docUrl = await createNdaVersion(page, base);
    await page.click("button:has-text('Ajukan Legal Review')");
    await page.waitForURL(/\/checkout\/[0-9a-f-]{36}/, { timeout: 30000 });
    const t = await page.innerText("main");
    for (const m of ["Dokumen yang akan diperiksa", "Perjanjian Kerahasiaan", "versi 1", "Kode versi", "Ruang lingkup", "Siapa yang memeriksa", "Langkah berikutnya", "Rp50.000", "Member aktif membayar Rp30.000", "AI gratis; Legal Review oleh pengacara berbayar", "menjamin hasil positif"]) {
      if (!t.includes(m)) throw new Error(`checkout tanpa "${m}": ${t.slice(0, 500)}`);
    }
    await page.waitForFunction(() => document.title === "Pembayaran | Yuktanya", null, { timeout: 10000 }).catch(async () => { throw new Error("judul " + (await page.title())); });
    await layoutOk();
    await shot("ux-checkout");
    await noEcho(new URL(page.url()).pathname + `?notice=${Q}`);
  });

  await step(tag("teks dari alamat di halaman aplikasi tidak ditampilkan; kode bawaan objek tidak membuat galat"), async () => {
    const doc = new URL(docUrl).pathname;
    for (const p of [
      `/workspace/new?error=${Q}`, `/workspace/new?error=__proto__`, `/settings?notice=${Q}`, `/settings?notice=constructor`, `/settings/hapus-akun?e=${Q}`,
      `${doc}?notice=${Q}&ai=toString&exported=..%2F..%2Flogout&pack=${Q}`, `/dashboard?error=${Q}`,
    ]) await noEcho(p);
    await page.goto(base + `${doc}?exported=..%2F..%2Flogout`);
    if (await page.locator("a[href*='logout']").count()) throw new Error("ID ekspor bebas masuk ke tautan");
  });

  await step(tag("daftar versi menampilkan status nyata (belum diperiksa pengacara)"), async () => {
    await page.goto(docUrl);
    await page.locator("summary:has-text('Ubah atau salin dokumen')").click();
    const t = await page.innerText("main");
    if (!t.includes("Belum diperiksa pengacara")) throw new Error("status versi: " + t.slice(0, 300));
  });

  await step(tag("tanpa error konsol/halaman (CSP bernonce)"), async () => {
    const real = issues.filter((m) => !/Failed to load resource.*(favicon|_next\/static)/i.test(m) && !/status of (404|5\d\d|429)/.test(m));
    if (real.length) throw new Error(real.slice(0, 2).join(" || "));
  });
}

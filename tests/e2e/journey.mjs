let lastExport = "";
const say = async (page, text, expectReply) => {
  const before = await page.locator("ol li").count();
  await page.fill("textarea[name=message]", text);
  await page.click("button:has-text('Kirim')");
  await page.waitForFunction((n) => document.querySelectorAll("ol li").length >= n + 2, before, { timeout: 60000 });
  await page.waitForSelector(`li:has-text("${expectReply}")`, { timeout: 5000 });
  await page.waitForLoadState("networkidle");
};
const quota = async (page, base) => {
  await page.goto(base + "/dashboard");
  return (await page.locator("li:has-text('Sisa pesan AI')").innerText()).replace(/\s+/g, " ");
};

export async function journey({ page, step, shot, base, vp, issues, llm }) {
  const email = `uji+${Date.now()}@example.com`;
  await step(`[${vp.name}] beranda publik tampil`, async () => { await page.goto(base + "/"); await page.waitForSelector("h1"); await shot("00-home"); });
  await step(`[${vp.name}] /dashboard tanpa login dialihkan ke /login`, async () => {
    await page.goto(base + "/dashboard");
    if (!page.url().includes("/login")) throw new Error("tidak dialihkan: " + page.url());
  });
  await step(`[${vp.name}] daftar dengan email`, async () => {
    await page.goto(base + "/register"); await shot("01-register");
    await page.fill("input[name=email]", email); await page.fill("input[name=password]", "Sintetis-12345");
    await Promise.all([page.waitForURL("**/dashboard", { timeout: 30000 }), page.click("button[type=submit]")]);
    await shot("02-dashboard");
  });
  await step(`[${vp.name}] kuota awal 20 dari 20`, async () => {
    const q = await quota(page, base);
    if (!/20 dari 20/.test(q)) throw new Error(q);
  });
  await step(`[${vp.name}] buat dokumen: tidak ada form isian manual, hanya percakapan`, async () => {
    await page.goto(base + "/workspace/new"); await shot("03-new");
    await Promise.all([page.waitForURL(/\/workspace\/[0-9a-f-]{36}/, { timeout: 30000 }), page.click("form:has(input[value=NDA]) button")]);
    await page.waitForSelector("textarea[name=message]");
    if ((await page.locator("input[name=value], input[name=fieldKey]").count()) !== 0) throw new Error("masih ada isian manual");
    await shot("04-chat-kosong");
  });
  await step(`[${vp.name}] giliran 1: cerita mengisi yang tertulis; nilai karangan AI dibuang`, async () => {
    await say(page, "Saya Sinta Dewi ingin menjaga rahasia daftar pelanggan dari Budi Santoso selama 12 bulan.", "Baik, saya catat");
    await shot("05-giliran-1");
    const body = await page.locator("body").innerText();
    if (/Dokumen siap dibuat/.test(body)) throw new Error("dinyatakan siap padahal belum lengkap");
    const opener = page.locator("summary:has-text('Lihat draf dokumen')");
    if (await opener.isVisible()) await opener.click();
    const draft = await page.locator("article[aria-label='Pratinjau draf']:visible").first().innerText();
    if (!draft.includes("Sinta Dewi") || !draft.includes("Budi Santoso")) throw new Error("pratinjau tidak terisi");
    if (draft.includes("Jakarta Selatan")) throw new Error("kota karangan AI masuk draf");
  });
  await step(`[${vp.name}] giliran 2: jawaban lanjutan melengkapi dokumen`, async () => {
    await say(page, "Tanggal 16 Oktober 2026, tujuannya menilai rencana kerja sama, pengadilan di Jakarta Selatan.", "Baik, saya catat");
    await page.waitForSelector("text=Dokumen siap dibuat", { timeout: 15000 });
    await shot("06-siap");
  });
  await step(`[${vp.name}] giliran 3: koreksi lewat percakapan`, async () => {
    await say(page, "Maaf, ganti nama pihak kedua jadi Budi Hartono.", "Baik, saya catat");
    await page.locator("[aria-label='Dokumen siap dibuat'] summary").click();
    const ready = await page.locator("[aria-label='Dokumen siap dibuat']").innerText();
    if (!ready.includes("Budi Hartono") || ready.includes("Budi Santoso")) throw new Error("koreksi tidak diterapkan");
  });
  await step(`[${vp.name}] gateway gagal: pesan tersimpan, kuota tidak terpakai, Coba lagi berhasil`, async () => {
    llm.control.fail = 2;
    await page.fill("textarea[name=message]", "Sebenarnya Saya Sinta Dewi, bukan orang lain.");
    await page.click("button:has-text('Kirim')");
    await page.waitForSelector("text=Layanan AI sedang sibuk", { timeout: 60000 });
    await page.waitForSelector("button:has-text('Coba lagi')");
    await shot("07-gagal");
    const q = await quota(page, base);
    if (!/17 dari 20/.test(q)) throw new Error("kuota salah setelah gagal: " + q);
  });
  await step(`[${vp.name}] Coba lagi memakai pesan yang sama dan berhasil`, async () => {
    await page.goto(base + "/documents");
    await page.click("a:has-text('Lanjutkan mengisi')");
    await page.waitForSelector("button:has-text('Coba lagi')");
    await Promise.all([page.waitForLoadState("networkidle"), page.click("button:has-text('Coba lagi')")]);
    await page.waitForFunction(() => !document.body.innerText.includes("belum dijawab AI"), null, { timeout: 30000 });
    const q = await quota(page, base);
    if (!/16 dari 20/.test(q)) throw new Error("kuota salah setelah coba lagi: " + q);
  });
  await step(`[${vp.name}] buat dokumen (versi 1) dengan nilai terkoreksi`, async () => {
    await page.goto(base + "/documents");
    await page.click("a:has-text('Lanjutkan mengisi')");
    await Promise.all([page.waitForURL("**/documents/**", { timeout: 30000 }), page.click("button:has-text('Buat dokumen')")]);
    await page.waitForSelector("text=Perjanjian Kerahasiaan");
    const text = await page.locator("body").innerText();
    if (!text.includes("Budi Hartono") || text.includes("Budi Santoso")) throw new Error("versi tidak memuat koreksi");
    await shot("08-versi");
  });
  await step(`[${vp.name}] unduh DOCX`, async () => {
    await page.click("button:has-text('Unduh Word')");
    await page.waitForURL(/exported=/, { timeout: 30000 }); lastExport = page.url();
    const link = page.locator("a:has-text('Berkas siap')"); await link.waitFor({ timeout: 30000 });
    const [dl] = await Promise.all([page.waitForEvent("download"), link.click()]);
    if (!dl.suggestedFilename().endsWith(".docx")) throw new Error(dl.suggestedFilename());
  });
  await step(`[${vp.name}] unduh PDF`, async () => {
    await page.click("button:has-text('Unduh PDF')");
    await page.waitForURL((u) => /exported=/.test(u.href) && u.href !== lastExport, { timeout: 30000 });
    const link = page.locator("a:has-text('Berkas siap')"); await link.waitFor({ timeout: 30000 });
    const [dl] = await Promise.all([page.waitForEvent("download"), link.click()]);
    if (!dl.suggestedFilename().endsWith(".pdf")) throw new Error(dl.suggestedFilename());
  });
  await step(`[${vp.name}] semua model yang dipanggil = auto`, async () => {
    if (!llm.seen.length || llm.seen.some((r) => r.model !== "auto")) throw new Error(JSON.stringify(llm.seen.slice(0, 3)));
  });
  for (const [p, h] of [["/documents", "docs"], ["/vault", "vault"], ["/membership", "membership"], ["/reviews", "reviews"], ["/pricing", "pricing"]]) {
    await step(`[${vp.name}] ${p} tampil tanpa error`, async () => {
      const r = await page.goto(base + p);
      if (!r || r.status() >= 400) throw new Error("status " + r?.status());
      await shot(`09-${h}`);
    });
  }
  await step(`[${vp.name}] tidak ada scroll horizontal di /dashboard`, async () => {
    await page.goto(base + "/dashboard");
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (over > 1) throw new Error("meluap " + over + "px");
  });
  for (const p of ["/dashboard", "/workspace/new", "/documents", "/membership"]) {
    await step(`[${vp.name}] target sentuh >= 44px di ${p}`, async () => {
      await page.goto(base + p);
      const bad = await page.evaluate(() =>
        [...document.querySelectorAll("a[href], button, input:not([type=hidden]), select, textarea, summary")]
          .filter((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && !e.closest("[aria-hidden=true]") && r.height < 43.5 && !e.closest("nextjs-portal"); })
          .map((e) => `${e.tagName.toLowerCase()}:${(e.textContent || e.getAttribute("name") || "").trim().slice(0, 24)}:${Math.round(e.getBoundingClientRect().height)}px`),
      );
      if (bad.length) throw new Error(bad.slice(0, 6).join(" | "));
    });
  }
  await step(`[${vp.name}] tanpa error konsol/halaman`, async () => {
    const real = issues.filter((m) => !/Failed to load resource.*(favicon|_next\/static)/i.test(m) && !/status of 5\d\d|status of 429/.test(m));
    if (real.length) throw new Error(real.slice(0, 1).join(" || "));
  });
}

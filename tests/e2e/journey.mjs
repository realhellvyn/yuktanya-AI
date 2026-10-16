const SAMPLE = { text: "Contoh Isi", longtext: "daftar pelanggan dan harga modal untuk rencana kerja sama", date: "16 Oktober 2026", idr: "Rp1.000.000", integer: "12" };
let lastExport = "";
export async function journey({ page, step, shot, base, vp, issues }) {
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
  await step(`[${vp.name}] pilih NDA dan isi seluruh langkah`, async () => {
    await page.goto(base + "/workspace/new"); await shot("03-new");
    await Promise.all([page.waitForURL("**/workspace/**", { timeout: 30000 }), page.click("form:has(input[value=NDA]) button")]);
    for (let i = 0; i < 12; i++) {
      if (page.url().includes("ringkasan")) break;
      await shot(`04-step-${i + 1}`);
      const key = await page.inputValue("input[name=fieldKey]");
      const el = page.locator("input[name=value], textarea[name=value]").first();
      const t = await el.evaluate((n) => n.tagName);
      const val = key === "termMonths" ? SAMPLE.integer : key === "signingDate" ? SAMPLE.date : key === "disclosingParty" ? "Sinta Dewi" : key === "receivingParty" ? "Budi Santoso" : key === "disputeCity" ? "Jakarta Selatan" : SAMPLE.longtext;
      await el.fill(val);
      await Promise.all([page.waitForLoadState("networkidle"), page.click("button[type=submit]:has-text('Lanjut')")]);
      await page.waitForTimeout(300);
    }
    if (!page.url().includes("ringkasan")) throw new Error("tidak sampai ringkasan: " + page.url());
    await shot("05-ringkasan");
  });
  await step(`[${vp.name}] buat dokumen (versi 1)`, async () => {
    await Promise.all([page.waitForURL("**/documents/**", { timeout: 30000 }), page.click("button:has-text('Buat dokumen')")]);
    await page.waitForSelector("text=Perjanjian Kerahasiaan"); await shot("06-versi");
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
  for (const [p, h] of [["/documents", "docs"], ["/vault", "vault"], ["/membership", "membership"], ["/reviews", "reviews"], ["/pricing", "pricing"]]) {
    await step(`[${vp.name}] ${p} tampil tanpa error`, async () => {
      const r = await page.goto(base + p);
      if (!r || r.status() >= 400) throw new Error("status " + r?.status());
      await shot(`07-${h}`);
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
    const real = issues.filter((m) => !/Failed to load resource.*(favicon|_next\/static)/i.test(m));
    if (real.length) throw new Error(real.slice(0, 1).join(" || "));
  });
}

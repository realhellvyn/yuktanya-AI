// Pembantu bersama untuk perjalanan E2E: daftar akun, buat dokumen lewat percakapan.
export const PASSWORD = "Sintetis-12345";

export async function register(page, base, email) {
  await page.goto(base + "/register");
  await page.fill("input[name=email]", email);
  await page.fill("input[name=password]", PASSWORD);
  await Promise.all([page.waitForURL("**/dashboard", { timeout: 30000 }), page.click("button[type=submit]")]);
}

export async function login(page, base, email) {
  await page.goto(base + "/login");
  await page.fill("input[name=email]", email);
  await page.fill("input[name=password]", PASSWORD);
  await Promise.all([page.waitForURL("**/dashboard", { timeout: 30000 }), page.click("button[type=submit]")]);
}

export async function say(page, text, expectReply) {
  const before = await page.locator("ol li").count();
  await page.fill("textarea[name=message]", text);
  await page.click("button:has-text('Kirim')");
  await page.waitForFunction((n) => document.querySelectorAll("ol li").length >= n + 2, before, { timeout: 60000 });
  await page.waitForSelector(`li:has-text("${expectReply}")`, { timeout: 5000 });
  await page.waitForLoadState("networkidle");
}

// Satu cerita lengkap untuk NDA sintetis; hasilnya: dokumen versi 1 dan URL /documents/<id>.
export async function createNdaVersion(page, base, { disclosing = "Sinta Dewi", receiving = "Budi Santoso" } = {}) {
  await page.goto(base + "/workspace/new");
  await Promise.all([page.waitForURL(/\/workspace\/[0-9a-f-]{36}/, { timeout: 30000 }), page.click("form:has(input[value=NDA]) button")]);
  await page.waitForSelector("textarea[name=message]");
  await say(page, `Saya ${disclosing} ingin menjaga rahasia daftar pelanggan dari ${receiving} selama 12 bulan. Tanggal 16 Oktober 2026, tujuannya menilai rencana kerja sama, pengadilan di Jakarta Selatan.`, "Baik, saya catat");
  await page.waitForSelector("text=Dokumen siap dibuat", { timeout: 15000 });
  await Promise.all([page.waitForURL("**/documents/**", { timeout: 30000 }), page.click("button:has-text('Buat dokumen')")]);
  await page.waitForSelector("text=Perjanjian Kerahasiaan");
  return page.url();
}

// Kirim form aksi server lalu tunggu hasilnya benar-benar diterapkan di halaman.
// waitForLoadState("networkidle") saja tidak cukup: untuk navigasi sisi klien ia langsung selesai, sehingga form berikutnya
// bisa terkirim dengan `revision` tersembunyi yang lama (STALE_REVISION). Maka tunggu URL tujuan redirect dan,
// bila form membawa `revision`, tunggu nilainya berganti (atau muncul ?e= untuk kegagalan).
// Revisi dibaca dari input `revision` milik form yang diklik sendiri (bukan input pertama di halaman), dan setelah redirect
// ditunggu pada form di posisi yang sama (indeks di antara form ber-`revision`), karena satu halaman bisa memuat banyak form.
export async function submit(page, clickable) {
  const form = clickable.locator("xpath=ancestor::form[1]");
  const own = form.locator("input[name=revision]");
  const rev = (await own.count()) ? await own.first().inputValue() : null;
  const idx = rev === null ? -1 : await form.evaluate((f) => [...document.querySelectorAll("form")].filter((x) => x.querySelector("input[name=revision]")).indexOf(f));
  const [res] = await Promise.all([page.waitForResponse((r) => r.request().method() === "POST", { timeout: 20000 }), clickable.click()]);
  const target = (res.headers()["x-action-redirect"] ?? "").split(";")[0];
  if (target) await page.waitForURL((u) => u.pathname + u.search === target, { timeout: 20000 });
  if (rev !== null) {
    await page.waitForFunction(([old, i]) => {
      const forms = [...document.querySelectorAll("form")].filter((x) => x.querySelector("input[name=revision]"));
      const input = forms[i]?.querySelector("input[name=revision]");
      return !input || input.value !== old || /[?&]e=/.test(location.search);
    }, [rev, idx], { timeout: 20000 });
  }
  await page.waitForLoadState("networkidle");
}

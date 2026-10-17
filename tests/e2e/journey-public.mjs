// Halaman publik & akun (Task 2): terbuka tanpa login, penanda wajib, tanpa overflow, lupa/atur ulang kata sandi, kirim ulang konfirmasi, /settings.
import { PASSWORD, register } from "./helpers.mjs";

const LEGAL_PENDING = "Menunggu persetujuan mitra hukum";
const PUBLIC = [
  { path: "/privacy", markers: ["Kebijakan Privasi", LEGAL_PENDING, "FreeLLMAPI"], legal: true },
  { path: "/terms", markers: ["Syarat Penggunaan", LEGAL_PENDING, "00.00 WIB"], legal: true },
  { path: "/bantuan", markers: ["Cara membuat dokumen", "Saluran kontak belum tersedia", "Cara mengecek keaslian dokumen"] },
  { path: "/design-preview", markers: ["Pratinjau desain", "Lencana status", "Indikator langkah", "Salah isi"], noindex: true },
  { path: "/forgot-password", markers: ["Lupa kata sandi"] },
];

export async function journey({ page, step, shot, base, vp, issues, fake, newActor }) {
  const tag = (s) => `[${vp.name}] ${s}`;
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const smallTargets = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("a[href], button, input:not([type=hidden]):not([type=checkbox]), select, textarea, summary")]
        .filter((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && !e.closest("[aria-hidden=true]") && !e.closest("nextjs-portal") && r.height < 43.5; })
        .map((e) => `${e.tagName.toLowerCase()}:${(e.textContent || e.getAttribute("name") || "").trim().slice(0, 24)}:${Math.round(e.getBoundingClientRect().height)}px`),
    );

  // Audit C22: header keamanan di halaman utama; skrip berjalan dengan nonce (tanpa pelanggaran CSP di konsol).
  await step(tag("/ mengirim header keamanan (CSP dengan nonce, frame-ancestors none, XFO, nosniff, referrer, permissions)"), async () => {
    const r = await page.goto(base + "/");
    const h = r.headers();
    const csp = h["content-security-policy"] ?? "";
    const want = [/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/, /frame-ancestors 'none'/, /object-src 'none'/, /base-uri 'self'/, /form-action 'self'/];
    for (const re of want) if (!re.test(csp)) throw new Error(`CSP tanpa ${re}: ${csp}`);
    if (/script-src[^;]*'unsafe-inline'/.test(csp)) throw new Error("script-src tidak boleh 'unsafe-inline'");
    const expect = { "x-frame-options": "DENY", "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin" };
    for (const [k, v] of Object.entries(expect)) if (h[k] !== v) throw new Error(`${k}=${h[k]}`);
    if (!/camera=\(\)/.test(h["permissions-policy"] ?? "") || !/geolocation=\(\)/.test(h["permissions-policy"] ?? "")) throw new Error("permissions-policy " + h["permissions-policy"]);
    const nonce = /'nonce-([^']+)'/.exec(csp)[1];
    // Semua <script> dalam HTML dari server membawa nonce permintaan ini (skrip yang dimuat kemudian diizinkan oleh 'strict-dynamic').
    const tags = (await r.text()).match(/<script\b[^>]*>/g) ?? [];
    const missing = tags.filter((t) => !t.includes(`nonce="${nonce}"`));
    if (!tags.length || missing.length) throw new Error(`skrip tanpa nonce yang cocok: ${missing.slice(0, 2).join(" ")}`);
    await page.waitForLoadState("networkidle");
    const csp2 = issues.filter((i) => /Content Security Policy|Refused to/i.test(i));
    if (csp2.length) throw new Error("pelanggaran CSP: " + csp2.join(" | "));
  });

  for (const { path, markers, legal, noindex } of PUBLIC) {
    await step(tag(`${path} terbuka tanpa login, memuat penanda, tanpa overflow dan target sentuh >= 44px`), async () => {
      const r = await page.goto(base + path);
      if (!r || r.status() !== 200) throw new Error("status " + r?.status());
      if (new URL(page.url()).pathname !== path) throw new Error("dialihkan ke " + page.url());
      const text = await page.innerText("body");
      for (const m of markers) if (!text.includes(m)) throw new Error(`penanda hilang: ${m}`);
      if (legal) {
        const sections = await page.locator("main section").count();
        const badges = await page.locator("main section", { hasText: LEGAL_PENDING }).count();
        if (sections < 4 || badges !== sections) throw new Error(`setiap bagian hukum wajib bertanda: ${badges}/${sections}`);
        if (/\b(?:email|surel)\s*:?\s*\S+@\S+/i.test(text)) throw new Error("kontak karangan terdeteksi");
      }
      if (noindex && !(await page.locator('meta[name=robots][content*=noindex]').count())) throw new Error("design-preview harus noindex");
      if (/\bcap\b/i.test(text)) throw new Error('kata "cap" muncul di tampilan');
      const over = await overflow();
      if (over > 1) throw new Error("meluap " + over + "px");
      const bad = await smallTargets();
      if (bad.length) throw new Error(bad.slice(0, 6).join(" | "));
      await shot("p-" + path.replace(/\W/g, ""));
    });
  }

  await step(tag("footer di beranda memuat tautan Privasi, Syarat, Bantuan; form daftar menautkan Privasi dan Syarat"), async () => {
    await page.goto(base + "/");
    for (const [name, href] of [["Kebijakan Privasi", "/privacy"], ["Syarat Penggunaan", "/terms"], ["Bantuan", "/bantuan"]]) {
      if (!(await page.locator(`footer a[href="${href}"]`, { hasText: name }).count())) throw new Error(`footer tanpa ${name}`);
    }
    await page.goto(base + "/register");
    for (const href of ["/privacy", "/terms"]) if (!(await page.locator(`form a[href="${href}"]`).count())) throw new Error(`form daftar tanpa ${href}`);
    if (await overflow() > 1) throw new Error("form daftar meluap");
  });

  await step(tag("/settings tanpa login diarahkan ke /login"), async () => {
    await page.goto(base + "/settings");
    const u = new URL(page.url());
    if (u.pathname !== "/login") throw new Error("tidak diarahkan: " + page.url());
  });

  const email = `publik+${Date.now()}@example.com`;
  await step(tag("lupa kata sandi menampilkan konfirmasi dan mengirim permintaan ke penyedia"), async () => {
    await page.goto(base + "/forgot-password");
    await page.fill("input[name=email]", email);
    await Promise.all([page.waitForURL(/sent=1/, { timeout: 20000 }), page.click("button[type=submit]")]);
    await page.waitForSelector("text=Permintaan diterima");
    if (!fake.outbox.some((o) => o.kind === "recover" && o.email === email)) throw new Error("permintaan recover tidak sampai ke penyedia");
    if (await overflow() > 1) throw new Error("meluap");
    await shot("p-forgot-sent");
  });

  await step(tag("kirim ulang konfirmasi dari halaman masuk yang gagal menampilkan pesan sukses"), async () => {
    await page.goto(base + "/login?error=failed");
    await page.waitForSelector("text=Belum menerima email konfirmasi?");
    await page.getByLabel("Email untuk kirim ulang konfirmasi").fill(email);
    await Promise.all([page.waitForURL(/resent=1/, { timeout: 20000 }), page.click("button:has-text('Kirim ulang email konfirmasi')")]);
    await page.waitForSelector("text=Email konfirmasi dikirim ulang");
    if (!fake.outbox.some((o) => o.kind === "resend" && o.email === email)) throw new Error("resend tidak sampai ke penyedia");
  });

  await step(tag("/reset-password tanpa sesi pemulihan menjelaskan tautan tidak berlaku"), async () => {
    await page.goto(base + "/reset-password");
    await page.waitForSelector("text=Tautan atur ulang sudah tidak berlaku");
  });

  const actor = await newActor("akun");
  const ap = actor.page;
  const user = `akun+${Date.now()}@example.com`;
  const NEW_PASSWORD = "Baru-Sintetis-67890";
  await step(tag("pengguna masuk melihat /settings: email, paket, sisa kuota, tautan privasi; tanpa overflow"), async () => {
    await register(ap, base, user);
    const r = await ap.goto(base + "/settings");
    if (!r || r.status() !== 200 || new URL(ap.url()).pathname !== "/settings") throw new Error("tidak terbuka: " + ap.url());
    const text = await ap.innerText("body");
    if (!(await ap.locator("[data-testid=account-email]").innerText()).includes(user)) throw new Error("email akun tidak tampil");
    for (const m of ["Akun", "Privasi", "Gratis", "Pesan AI: 20 dari 20", "Dokumen baru: 1 dari 1"]) if (!text.includes(m)) throw new Error("penanda hilang: " + m);
    // Task 8: kedua aksi kini nyata (diuji ujung-ke-ujung di journey-data-rights.mjs); pastikan menuju rute yang benar.
    if (!(await ap.locator("a[href='/settings/export']", { hasText: "Unduh data saya" }).count())) throw new Error("tautan Unduh data saya hilang");
    if (!(await ap.locator("a[href='/settings/hapus-akun']", { hasText: "Hapus akun" }).count())) throw new Error("tautan Hapus akun hilang");
    const over = await ap.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (over > 1) throw new Error("meluap " + over + "px");
    await actor.shot("p-settings");
  });

  await step(tag("sesi masuk biasa DITOLAK mengganti kata sandi di /reset-password (tanpa tautan pemulihan)"), async () => {
    await ap.goto(base + "/reset-password");
    await ap.waitForSelector("text=Tautan atur ulang sudah tidak berlaku");
    if (await ap.locator("input[name=password]").count()) throw new Error("form ganti sandi tampil untuk sesi biasa");
  });

  await step(tag("lewat tautan pemulihan: sandi tak sama ditolak, sandi baru berhasil, lama tak berlaku"), async () => {
    const rec = await newActor("pemulihan");
    const rp = rec.page;
    await rp.goto(base + "/forgot-password");
    await rp.fill("input[name=email]", user);
    await Promise.all([rp.waitForURL(/sent=1/, { timeout: 20000 }), rp.click("button[type=submit]")]);
    const mail = [...fake.outbox].reverse().find((o) => o.kind === "recover" && o.email === user);
    if (!mail?.code) throw new Error("kode pemulihan tidak ada");
    await rp.goto(`${base}/auth/callback?code=${mail.code}&next=${encodeURIComponent("/reset-password")}`);
    await rp.waitForURL(/\/reset-password/, { timeout: 20000 });
    await rp.waitForSelector("input[name=confirm]");
    await rp.fill("input[name=password]", NEW_PASSWORD);
    await rp.fill("input[name=confirm]", NEW_PASSWORD + "x");
    await Promise.all([rp.waitForURL(/error=mismatch/, { timeout: 20000 }), rp.click("button[type=submit]")]);
    await rp.waitForSelector("text=Kedua kata sandi belum sama");
    await rp.fill("input[name=password]", NEW_PASSWORD);
    await rp.fill("input[name=confirm]", NEW_PASSWORD);
    await Promise.all([rp.waitForURL(/done=1/, { timeout: 20000 }), rp.click("button[type=submit]")]);
    await rp.waitForSelector("text=Kata sandi berhasil diganti");
    const fresh = await newActor("masuk-ulang");
    const tryLogin = async (pw) => {
      await fresh.page.goto(base + "/login");
      await fresh.page.fill("input[name=email]", user);
      await fresh.page.fill("input[name=password]", pw);
      await fresh.page.click("button[type=submit]");
      await fresh.page.waitForURL(/\/dashboard|error=/, { timeout: 30000 });
      return new URL(fresh.page.url()).pathname === "/dashboard";
    };
    if (await tryLogin(PASSWORD)) throw new Error("kata sandi lama masih berlaku");
    if (!(await tryLogin(NEW_PASSWORD))) throw new Error("kata sandi baru tidak bisa dipakai masuk");
  });

  await step(tag("tanpa error konsol/halaman"), async () => {
    const real = [...issues, ...actor.issues].filter((m) => !/Failed to load resource.*(favicon|_next\/static)/i.test(m) && !/status of (4|5)\d\d/.test(m));
    if (real.length) throw new Error(real.slice(0, 1).join(" || "));
  });
}

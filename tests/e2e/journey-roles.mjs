// Perjalanan lintas peran (E01/E02 di SCENARIOS): admin -> koordinator -> reviewer -> pemilik, dengan sesi browser terpisah.
import { createNdaVersion, login, register } from "./helpers.mjs";

export const onlyViewport = "desktop";

export async function journey({ step, base, vp, db, newActor }) {
  const n = Date.now();
  const mail = (who) => `${who}+${n}@example.com`;
  const adminA = await newActor("admin"), coordA = await newActor("koordinator"), revA = await newActor("reviewer"), ownerA = await newActor("pemilik");
  let docUrl = "", requestId = "", code = "";
  const tag = (s) => `[${vp.name}] ${s}`;

  await step(tag("empat akun terdaftar; admin diberi peran lewat DB (bukan lewat UI)"), async () => {
    for (const [a, who] of [[adminA, "admin"], [coordA, "koordinator"], [revA, "reviewer"], [ownerA, "pemilik"]]) await register(a.page, base, mail(who));
    await db.query("insert into public.user_roles (user_id, role) select id, 'platform_admin' from auth.users where email = $1 on conflict do nothing", [mail("admin")]);
  });

  await step(tag("pengguna biasa ditolak masuk /admin, /partner"), async () => {
    for (const p of ["/admin", "/partner"]) {
      await ownerA.page.goto(base + p);
      if (!/\/login|\/dashboard/.test(ownerA.page.url())) throw new Error(`${p} terbuka untuk pengguna biasa: ${ownerA.page.url()}`);
    }
  });

  await step(tag("admin mendaftarkan firma, menambah koordinator & reviewer, memberi otorisasi"), async () => {
    const p = adminA.page;
    await p.goto(base + "/admin/partners");
    await p.fill("form:has(h2:has-text('Daftarkan firma')) input[name=name]", "Firma Uji E2E");
    await p.check("input[name=isDefault]");
    await Promise.all([p.waitForLoadState("networkidle"), p.click("button:has-text('Daftarkan')")]);
    const sec = p.locator("section[aria-label='Firma Uji E2E']");
    await sec.waitFor();
    const add = async (email, role) => {
      const f = p.locator("section[aria-label='Firma Uji E2E'] form:has(h3:has-text('Tambah anggota'))");
      await f.locator("input[name=email]").fill(email);
      await f.locator("select[name=role]").selectOption(role);
      await f.locator("button").click();
      await sec.locator(`li:has-text("${email}")`).waitFor({ timeout: 15000 });
    };
    await add(mail("koordinator"), "coordinator");
    await add(mail("reviewer"), "reviewer");
    const f = p.locator("section[aria-label='Firma Uji E2E'] form:has(h3:has-text('Beri otorisasi'))");
    await f.locator("input[name=email]").fill(mail("reviewer"));
    await f.locator("input[name=scope]").fill("Perjanjian kerahasiaan");
    await f.locator("input[name=validFrom]").fill("2026-01-01");
    await f.locator("input[name=validTo]").fill("2027-12-31");
    await f.locator("button").click();
    await sec.locator(`li:has-text("${mail("reviewer")}"):has-text("otorisasi 2026")`).waitFor({ timeout: 15000 });
    const text = await sec.innerText();
    if (!text.includes(mail("reviewer")) || !text.includes("otorisasi")) throw new Error(text.slice(0, 600));
    await adminA.shot("01-mitra");
  });

  await step(tag("pemilik membuat NDA lewat percakapan dan meminta pemeriksaan pengacara (Rp50.000)"), async () => {
    docUrl = await createNdaVersion(ownerA.page, base);
    await ownerA.page.click("button:has-text('Minta pemeriksaan pengacara')");
    await ownerA.page.waitForURL(/\/checkout\//, { timeout: 30000 });
    const t = await ownerA.page.innerText("body");
    if (!/50\.000/.test(t)) throw new Error("harga bukan Rp50.000: " + t.slice(0, 300));
    await ownerA.shot("02-checkout");
  });

  await step(tag("transfer bank menampilkan kode referensi; status belum lunas"), async () => {
    await ownerA.page.click("button:has-text('Bayar dengan transfer bank')");
    await ownerA.page.waitForSelector("text=Tulis kode berikut");
    const t = await ownerA.page.innerText("body");
    if (/lunas|dibayar/i.test(t) && !/belum/i.test(t)) throw new Error("terlihat lunas sebelum dikonfirmasi admin");
  });

  await step(tag("admin mengonfirmasi pembayaran; permintaan muncul untuk koordinator"), async () => {
    const p = adminA.page;
    await p.goto(base + "/admin/payments");
    const f = p.locator("section[aria-labelledby=menunggu-h] form").first();
    await f.locator("input[name=bankRef]").fill("BANK-UJI-001");
    await Promise.all([p.waitForLoadState("networkidle"), f.locator("button:has-text('Konfirmasi pembayaran')").click()]);
    const left = await p.locator("section[aria-labelledby=menunggu-h] form").count();
    if (left !== 0) throw new Error("pembayaran masih menunggu");
  });

  await step(tag("koordinator menugaskan ke reviewer (dipilih dengan email, bukan kode acak)"), async () => {
    const p = coordA.page;
    await p.goto(base + "/partner");
    const opt = await p.locator("select[name=reviewerId] option").first().innerText();
    if (!opt.includes(mail("reviewer"))) throw new Error("opsi reviewer: " + opt);
    await coordA.shot("03-koordinator");
    await p.click("button:has-text('Tugaskan')");
    await p.waitForSelector("text=Penugasan disimpan", { timeout: 15000 });
  });

  await step(tag("reviewer menulis lingkup + Legal Note penting, lalu menerbitkan WITH_NOTES"), async () => {
    const p = revA.page;
    await p.goto(base + "/partner");
    await p.click("ul a:has-text('Perjanjian Kerahasiaan')");
    requestId = p.url().split("/").pop().split("?")[0];
    await p.fill("textarea[name=scope]", "Kepatutan klausul kerahasiaan dan jangka waktu");
    await p.click("button:has-text('Simpan draf')");
    await p.waitForSelector("text=Tersimpan.", { timeout: 15000 });
    await p.fill("input[name=title]", "Definisi informasi rahasia terlalu sempit");
    await p.fill("textarea[name=finding]", "Definisi hanya mencakup daftar pelanggan.");
    await p.selectOption("select[name=severity]", "MATERIAL");
    await p.check("input[name=actionable]");
    await p.fill("textarea[name=recommendedAction]", "Perluas definisi informasi rahasia.");
    await p.fill("textarea[name=rationale]", "Risiko kebocoran informasi lain.");
    await p.fill("textarea[name=escalation]", "Konsultasikan dengan pengacara bila ada sengketa.");
    await p.click("button:has-text('Simpan catatan')");
    await p.waitForSelector("button:has-text('Hapus catatan 1')", { timeout: 15000 });
    await p.selectOption("select[name=outcome]", "WITH_NOTES");
    await p.check("input[name=attest]");
    await revA.shot("04-editor");
    await p.click("button:has-text('Terbitkan hasil')");
    await p.waitForURL(/done=|e=/, { timeout: 15000 });
    const r = await db.query("select v.code, v.status, v.outcome from document_verifications v where v.kind = 'LEGAL' order by issued_at desc limit 1");
    if (!r.rows[0] || r.rows[0].status !== "ACTIVE" || r.rows[0].outcome !== "WITH_NOTES") throw new Error(JSON.stringify(r.rows) + (await p.innerText("body")).slice(0, 300));
    code = r.rows[0].code;
  });

  await step(tag("pemilik melihat hasil; halaman publik /verify menunjukkan Aktif tanpa login"), async () => {
    await ownerA.page.goto(base + "/reviews");
    await ownerA.page.click("a[href^='/reviews/']");
    await ownerA.shot("05-hasil");
    const pub = await (await ownerA.page.context().browser().newContext()).newPage();
    await pub.goto(base + "/verify/" + code);
    if (!(await pub.innerText("body")).includes("Aktif")) throw new Error("tidak Aktif");
    await pub.close();
  });

  await step(tag("admin mencabut; publik langsung Dicabut"), async () => {
    const p = adminA.page;
    await p.goto(base + "/admin/verifications");
    await p.fill("input[name=note]", "Pencabutan uji E2E");
    await Promise.all([p.waitForLoadState("networkidle"), p.click("button:has-text('Cabut verifikasi')")]);
    const pub = await (await adminA.page.context().browser().newContext()).newPage();
    await pub.goto(base + "/verify/" + code);
    if (!(await pub.innerText("body")).includes("Dicabut")) throw new Error("tidak Dicabut");
    await pub.close();
  });
}

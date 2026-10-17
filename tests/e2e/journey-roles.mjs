// Perjalanan lintas peran (E01/E02 di SCENARIOS): admin -> koordinator -> reviewer -> pemilik, dengan sesi browser terpisah.
import { createNdaVersion, register, say, submit } from "./helpers.mjs";

export const onlyViewport = "desktop";
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
// Logika sama dengan journey-ui-roles.mjs: elemen interaktif terlihat yang tingginya < 43.5px.
const smallTargets = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("a[href], button, input:not([type=hidden]):not([type=checkbox]), select, textarea, summary")]
      .filter((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && !e.closest("[aria-hidden=true]") && !e.closest("nextjs-portal") && r.height < 43.5; })
      .map((e) => `${e.tagName.toLowerCase()}:${(e.textContent || e.getAttribute("name") || "").trim().slice(0, 24)}:${Math.round(e.getBoundingClientRect().height)}px`),
  );
const PAY_STATEMENT = "Pembayaran tidak menjamin Enhanced, kesimpulan yang menguntungkan, keabsahan hukum, atau hasil di pengadilan.";
const VERIFIED_LABEL = "Dokumen versi ini telah diperiksa oleh profesional hukum sesuai ruang lingkup review yang tercantum. Tidak menjamin keabsahan atau hasil hukum tertentu.";

export async function journey({ step, base, vp, db, newActor }) {
  const n = Date.now();
  const mail = (who) => `${who}+${n}@example.com`;
  const adminA = await newActor("admin"), coordA = await newActor("koordinator"), revA = await newActor("reviewer"), ownerA = await newActor("pemilik");
  let code = "", enhancedCode = "", docUrl = "";
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

  await step(tag("pengguna biasa dan akun reviewer saja ditolak di /admin dan /admin/payments"), async () => {
    for (const [who, actor] of [["pengguna biasa", ownerA], ["reviewer", revA]]) {
      for (const p of ["/admin", "/admin/payments"]) {
        await actor.page.goto(base + p);
        const u = new URL(actor.page.url());
        if (u.pathname.startsWith("/admin")) throw new Error(`${p} terbuka untuk ${who}: ${actor.page.url()}`);
        if (/Konfirmasi pembayaran|menunggu konfirmasi/i.test(await actor.page.innerText("body"))) throw new Error(`${p} membocorkan isi admin ke ${who}`);
      }
    }
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
    await p.locator("dialog[open]").waitFor();
    const confirmText = await p.locator("dialog[open]").innerText();
    if (!/Versi 1/.test(confirmText) || !confirmText.includes("Dengan Legal Note") || !confirmText.includes("Kepatutan klausul kerahasiaan") || !/Catatan 1/.test(confirmText)) throw new Error("konfirmasi akhir tidak lengkap: " + confirmText.slice(0, 400));
    // Pernyataan tidak ada konflik kepentingan wajib: tombol terbit nonaktif sampai dicentang.
    if (!(await p.locator("dialog[open] button:has-text('Ya, terbitkan sekarang')").isDisabled())) throw new Error("terbit aktif tanpa pernyataan konflik");
    await p.check("dialog[open] input[name=noConflict]");
    await p.click("dialog[open] button:has-text('Ya, terbitkan sekarang')");
    await p.waitForURL(/done=|e=/, { timeout: 15000 });
    const r = await db.query("select v.code, v.status, v.outcome from document_verifications v where v.kind = 'LEGAL' order by issued_at desc limit 1");
    if (!r.rows[0] || r.rows[0].status !== "ACTIVE" || r.rows[0].outcome !== "WITH_NOTES") throw new Error(JSON.stringify(r.rows) + (await p.innerText("body")).slice(0, 300));
    code = r.rows[0].code;
  });

  await step(tag("pemilik melihat hasil; halaman publik /verify menunjukkan Aktif tanpa login"), async () => {
    await ownerA.page.goto(base + "/reviews");
    await ownerA.page.click("a[href^='/reviews/']");
    await ownerA.page.waitForURL(/\/reviews\/[0-9a-f-]{36}$/);
    await ownerA.shot("05-hasil");
    // Label Verified wajib (SECURITY_AND_LEGAL) tampil persis di hasil pemilik dan di halaman publik.
    if (!(await ownerA.page.innerText("main")).includes(VERIFIED_LABEL)) throw new Error("label Verified tidak ada di hasil pemilik");
    const pub = await (await ownerA.page.context().browser().newContext()).newPage();
    await pub.goto(base + "/verify/" + code);
    const pubText = await pub.innerText("body");
    if (!pubText.includes("Aktif")) throw new Error("tidak Aktif");
    if (!pubText.includes(VERIFIED_LABEL)) throw new Error("label Verified tidak ada di /verify");
    // Tangkapan layar /verify dan /login (desktop dan HP) untuk tinjauan visual brand (Task 18).
    const dir = process.env.SHOTS_DIR ?? "/tmp/yk-shots";
    for (const [w, width, height] of [["desktop", 1280, 800], ["hp", 375, 812]]) {
      await pub.setViewportSize({ width, height });
      await pub.goto(base + "/verify/" + code);
      await pub.screenshot({ path: `${dir}/publik-${w}-verify.png`, fullPage: true });
      await pub.goto(base + "/login");
      await pub.screenshot({ path: `${dir}/publik-${w}-login.png`, fullPage: true });
    }
    await pub.close();
  });


  await step(tag("admin mencatat persetujuan rubrik; pemilik melihat tawaran Deep Review Rp200.000 dan memesan"), async () => {
    await adminA.page.goto(base + "/admin/rubric");
    await adminA.page.fill("input[name=signoffRef]", "SIGNOFF-UJI-E2E");
    await submit(adminA.page, adminA.page.locator("button:has-text('Catat persetujuan')"));
    await ownerA.page.goto(base + "/reviews");
    await ownerA.page.click("a[href^='/reviews/']");
    await ownerA.page.waitForSelector("text=Pemeriksaan mendalam (tambahan)");
    const offer = await ownerA.page.innerText("body");
    if (!/200\.000/.test(offer) || !/tidak menjamin/i.test(offer)) throw new Error("tawaran tidak lengkap: " + offer.slice(0, 400));
    await ownerA.shot("06-tawaran-deep");
    const reviewId = /\/reviews\/([0-9a-f-]{36})/.exec(ownerA.page.url())[1];
    // Halaman rincian /reviews/[id]/deep: harga, pernyataan wajib, lalu tombol menerima.
    await ownerA.page.click("a:has-text('Lihat rincian pemeriksaan mendalam')");
    await ownerA.page.waitForURL(/\/reviews\/[0-9a-f-]{36}\/deep$/);
    const detail = await ownerA.page.innerText("main");
    if (!detail.includes("Rp200.000") || !detail.includes(PAY_STATEMENT)) throw new Error("rincian tawaran tidak lengkap: " + detail.slice(0, 500));
    for (const vp of [{ width: 375, height: 800 }, { width: 1280, height: 800 }]) {
      await ownerA.page.setViewportSize(vp);
      if ((await overflow(ownerA.page)) > 1) throw new Error(`/reviews/[id]/deep meluap @${vp.width}px`);
      const small = await smallTargets(ownerA.page);
      if (small.length) throw new Error(`target kecil di /reviews/[id]/deep @${vp.width}px: ${small.join(", ")}`);
    }
    await ownerA.shot("06b-rincian-deep");
    // Pemilik lain: 404 pada halaman rincian yang sama.
    const stranger = await newActor("pemilik-lain");
    await register(stranger.page, base, mail("pemilik-lain"));
    const r404 = await stranger.page.goto(base + `/reviews/${reviewId}/deep`);
    if (r404.status() !== 404) throw new Error("pemilik lain mendapat status " + r404.status() + " di /reviews/[id]/deep");
    ownerA.deepStranger = stranger;
    await ownerA.page.click("button:has-text('Lanjut ke pembayaran')");
    await ownerA.page.waitForURL(/\/checkout\//);
    await ownerA.page.click("button:has-text('Bayar dengan transfer bank')");
    await ownerA.page.waitForSelector("text=Tulis kode berikut");
  });

  await step(tag("admin konfirmasi bayar; koordinator menugaskan"), async () => {
    const a = adminA.page;
    await a.goto(base + "/admin/payments");
    await a.locator("section[aria-labelledby=menunggu-h] form input[name=bankRef]").first().fill("BANK-UJI-DEEP");
    await submit(a, a.locator("section[aria-labelledby=menunggu-h] form button:has-text('Konfirmasi pembayaran')").first());
    const c = coordA.page;
    await c.goto(base + "/partner");
    await submit(c, c.locator("section[aria-labelledby=deepc-h] form button:has-text('Simpan')").first());
  });

  await step(tag("halaman status /deep-reviews/[id]: tahapan, tanpa Enhanced sebelum diputuskan; tautan dari /reviews/[id]; 375px; pemilik lain 404"), async () => {
    const p = ownerA.page;
    await p.goto(base + "/reviews");
    await p.click("a[href^='/reviews/']");
    await p.click("a:has-text('Lihat status pemeriksaan mendalam')");
    await p.waitForURL(/\/deep-reviews\/[0-9a-f-]{36}$/);
    const url = p.url();
    const t = await p.innerText("main");
    for (const w of ["Dipesan", "Dibayar", "Ditugaskan", "Diperiksa", "Selesai", "Hasil akan muncul"]) if (!t.includes(w)) throw new Error(`status tanpa "${w}": ` + t.slice(0, 400));
    if (!/Ditugaskan\s*— selesai/.test(t)) throw new Error("tahap Ditugaskan belum selesai: " + t.slice(0, 400));
    if (/Yuktanya Legal Verified — Enhanced|Enhanced disetujui/.test(t)) throw new Error("Enhanced tampil sebelum diputuskan");
    for (const vp of [{ width: 375, height: 800 }, { width: 1280, height: 800 }]) {
      await p.setViewportSize(vp);
      if ((await overflow(p)) > 1) throw new Error(`/deep-reviews/[id] meluap @${vp.width}px`);
      const small = await smallTargets(p);
      if (small.length) throw new Error(`target kecil di /deep-reviews/[id] @${vp.width}px: ${small.join(", ")}`);
    }
    const r = await ownerA.deepStranger.page.goto(url);
    if (r.status() !== 404) throw new Error("pemilik lain mendapat status " + r.status() + " di /deep-reviews/[id]");
  });

  await step(tag("reviewer mengisi checklist M1-M7 dan menyetujui Enhanced"), async () => {
    const r = revA.page;
    await r.goto(base + "/partner");
    await r.click("section[aria-labelledby=deepq-h] a");
    await r.waitForSelector("text=Pekerjaan tambahan");
    await r.fill("textarea[name=extraWork]", "Memeriksa ulang klausul kerahasiaan dan kecukupan definisi terhadap catatan standar.");
    await submit(r, r.locator("button:has-text('Simpan pekerjaan tambahan')"));
    await r.selectOption("form:has(input[name=noteNo]) select[name=disposition]", "RESOLVED");
    await r.fill("form:has(input[name=noteNo]) input[name=evidence]", "Klausul 1 telah diperluas");
    await submit(r, r.locator("button:has-text('Simpan tindak lanjut')").first());
    for (const item of ["M1", "M2", "M3", "M4", "M5", "M6", "M7"]) {
      const f = r.locator(`form:has(input[name=item][value=${item}])`);
      await f.locator("select[name=result]").selectOption("PASS");
      await f.locator("textarea[name=reasoning]").fill(`Butir ${item} terpenuhi`);
      await f.locator("input[name=evidenceRef]").fill(`Bukti ${item}`);
      await submit(r, f.locator("button"));
    }
    await revA.shot("07-deep");
    await r.selectOption("select[name=decision]", "APPROVE");
    await r.check("input[name=attest]");
    await r.click("button:has-text('Simpan keputusan')");
    await r.locator("dialog[open]").waitFor();
    if (!(await r.locator("dialog[open]").innerText()).includes("Setujui Enhanced")) throw new Error("konfirmasi keputusan tidak menyebut keputusan");
    if (!(await r.locator("dialog[open] button:has-text('Ya, simpan keputusan')").isDisabled())) throw new Error("keputusan aktif tanpa pernyataan konflik");
    await r.check("dialog[open] input[name=noConflict]");
    await submit(r, r.locator("dialog[open] button:has-text('Ya, simpan keputusan')"));
    const q = await db.query("select code, status from document_verifications where kind = 'LEGAL_ENHANCED' order by issued_at desc limit 1");
    if (!q.rows[0] || q.rows[0].status !== "ACTIVE") {
      const dbg = await db.query("select d.status, d.order_id, rp.status as rs, rp.revision, rp.decision, (select count(*) from deep_checklist c where c.report_id = rp.id) as chk, (select string_agg(o.status || '/' || coalesce(p.status, '-'), ',') from orders o left join payments p on p.order_id = o.id where o.id = d.order_id) as pay from deep_requests d left join deep_reports rp on rp.deep_id = d.id order by d.created_at desc limit 1");
      throw new Error("Enhanced tidak terbit: " + JSON.stringify(q.rows) + " | " + r.url() + " | " + JSON.stringify(dbg.rows));
    }
    enhancedCode = q.rows[0].code;
  });

  await step(tag("pemilik melihat Enhanced; pencabutan verifikasi induk menangguhkan Enhanced"), async () => {
    await ownerA.page.goto(base + "/reviews");
    await ownerA.page.click("a[href^='/reviews/']");
    await ownerA.page.click("a:has-text('Lihat status pemeriksaan mendalam')");
    await ownerA.page.waitForURL(/\/deep-reviews\//);
    const done = await ownerA.page.innerText("main");
    if (!done.includes("Enhanced disetujui") || !done.includes("Batasan:") || !done.includes("Pembayaran tidak menjamin Enhanced")) throw new Error("hasil Enhanced tidak lengkap: " + done.slice(0, 500));
    await ownerA.shot("07b-status-deep");
    const pub = await (await ownerA.page.context().browser().newContext()).newPage();
    await pub.goto(base + "/verify/" + enhancedCode);
    if (!(await pub.innerText("body")).includes("Aktif")) throw new Error("Enhanced tidak aktif");
    await pub.close();
  });

  await step(tag("admin mencabut; publik langsung Dicabut"), async () => {
    const p = adminA.page;
    await p.goto(base + "/admin/verifications?q=" + code);
    await p.fill("input[name=note]", "Pencabutan uji E2E");
    await Promise.all([p.waitForLoadState("networkidle"), p.click("button:has-text('Cabut verifikasi')")]);
    const pub = await (await adminA.page.context().browser().newContext()).newPage();
    await pub.goto(base + "/verify/" + code);
    if (!(await pub.innerText("body")).includes("Dicabut")) throw new Error("tidak Dicabut");
    await pub.goto(base + "/verify/" + enhancedCode);
    const enhancedText = await pub.innerText("body");
    if (!/Ditangguhkan|Dicabut/.test(enhancedText)) throw new Error("Enhanced tetap aktif padahal induk dicabut");
    if (/\bAktif\b/.test(enhancedText)) throw new Error("halaman Enhanced masih menampilkan Aktif setelah induk dicabut");
    
    // Pemilik: halaman status tidak lagi mengaku "Enhanced disetujui" setelah induk dicabut.
    await ownerA.page.goto(base + "/reviews");
    await ownerA.page.click("a[href^='/reviews/']");
    await ownerA.page.click("a:has-text('Lihat status pemeriksaan mendalam')");
    await ownerA.page.waitForURL(/\/deep-reviews\//);
    const lapsed = await ownerA.page.innerText("main");
    if (/Enhanced disetujui|memastikan semua syarat/.test(lapsed)) throw new Error("halaman pemilik masih mengaku Enhanced disetujui setelah pencabutan: " + lapsed.slice(0, 500));
    if (!/Ditangguhkan|Dicabut/.test(lapsed) || !/pernah dicatat/.test(lapsed)) throw new Error("halaman pemilik tidak menjelaskan status Enhanced: " + lapsed.slice(0, 500));
    await ownerA.shot("07c-deep-ditangguhkan");
    await pub.close();
  });

  await step(tag("versi baru dari dokumen yang sama: belum diperiksa, tanpa lencana (E12)"), async () => {
    const p = ownerA.page;
    await p.goto(docUrl);
    const docId = /\/documents\/([0-9a-f-]{36})/.exec(docUrl)[1];
    await p.locator("summary:has-text('Ubah atau salin dokumen')").click();
    await Promise.all([p.waitForURL(/\/workspace\//, { timeout: 30000 }), p.click("button:has-text('Buat versi baru dari versi ini')")]);
    await say(p, "Maaf, ganti nama pihak kedua jadi Budi Hartono.", "Baik, saya catat");
    await Promise.all([p.waitForURL(/\/documents\/.*baru=1/, { timeout: 30000 }), p.click("button:has-text('Buat dokumen')")]);
    const t = await p.innerText("main");
    if (!t.includes("Versi 2") || !t.includes("Versi baru belum diperiksa")) throw new Error("versi 2 tidak ditandai belum diperiksa: " + t.slice(0, 400));
    if (/Status: (Aktif|Dicabut|Ditangguhkan)|Yuktanya Legal Verified/.test(t)) throw new Error("versi baru mewarisi lencana: " + t.slice(0, 400));
    const v2 = new URL(p.url()).searchParams.get("version");
    if (!v2) throw new Error("URL versi baru tanpa parameter version: " + p.url());
    const n = (await db.query("select count(*)::int as n from document_verifications where version_id = $1", [v2])).rows[0].n;
    const v1 = (await db.query("select count(*)::int as n from document_verifications v join document_versions dv on dv.id = v.version_id where dv.document_id = $1 and dv.version_no = 1", [docId])).rows[0].n;
    if (n !== 0 || v1 < 1) throw new Error(`verifikasi versi 2 = ${n}, versi 1 = ${v1}`);
    await ownerA.shot("08-versi-baru");
  });
}

// Task 21: pembayaran Midtrans (Snap redirect) terhadap Midtrans palsu (tests/e2e/fake-midtrans.mjs), desktop dan HP.
// Legal Review: kedaluwarsa → bayar ulang; notifikasi palsu (tanda tangan salah, atau tanda tangan sah tetapi API status
// belum lunas) ditolak; klik ulang memakai transaksi Snap yang sama; lunas lewat webhook → Legal Review terbuka.
// Membership: parameter status di URL kembali tidak pernah melunasi; "Perbarui status" melunasi bila webhook tidak datang.
// Transfer manual lama: pesanan lama tetap menampilkan instruksi dan tetap dapat dikonfirmasi admin.
import { createNdaVersion, payWithMidtrans, register, submit } from "./helpers.mjs";

export async function journey({ page, step, shot, base, vp, db, newActor, midtrans, issues }) {
  const n = `${Date.now()}-${vp.name}`;
  const tag = (s) => `[${vp.name}] ${s}`;
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const smallTargets = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("main a[href], main button, main input:not([type=hidden]):not([type=checkbox]), main select, main textarea, main summary")]
        .filter((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && !e.closest("[aria-hidden=true]") && !e.closest("nextjs-portal") && r.height < 43.5; })
        .map((e) => `${e.tagName.toLowerCase()}:${(e.textContent || "").trim().slice(0, 24)}:${Math.round(e.getBoundingClientRect().height)}px`),
    );
  const layoutOk = async () => {
    const over = await overflow();
    if (over > 1) throw new Error("meluap " + over + "px");
    const small = await smallTargets();
    if (small.length) throw new Error("target sentuh < 44px: " + small.slice(0, 5).join(" | "));
  };
  const orderOf = () => /\/checkout\/([0-9a-f-]{36})/.exec(page.url())[1];
  const orderRow = async (id) => (await db.query("select status from orders where id = $1", [id])).rows[0].status;
  const pays = async (id) => (await db.query("select provider, status, provider_ref from payments where order_id = $1 order by created_at", [id])).rows;
  let reviewOrder = "";

  await step(tag("checkout Legal Review: hanya 'Bayar dengan Midtrans' (tanpa transfer bank), tanpa overflow/target kecil"), async () => {
    await register(page, base, `midtrans+${n}@example.com`);
    await createNdaVersion(page, base);
    await page.click("button:has-text('Ajukan Legal Review')");
    await page.waitForURL(/\/checkout\/[0-9a-f-]{36}$/, { timeout: 30000 });
    reviewOrder = orderOf();
    const t = await page.innerText("main");
    if (/transfer bank/i.test(await page.locator("main button").allInnerTexts().then((x) => x.join("|")))) throw new Error("tombol transfer bank masih ada");
    if (!t.includes("Bayar dengan Midtrans") || !t.includes("tidak menyimpan data kartu")) throw new Error("opsi Midtrans tidak lengkap: " + t.slice(0, 500));
    await layoutOk();
    await shot("midtrans-01-checkout");
  });

  await step(tag("Snap menerima jumlah dan finish dari server, tanpa data pribadi; transaksi dibiarkan kedaluwarsa → bisa bayar ulang"), async () => {
    const { orderRef, result } = await payWithMidtrans(page, base, "Biarkan kedaluwarsa");
    const tx = midtrans.txs.get(orderRef);
    if (!tx) throw new Error("transaksi Snap tidak tercatat");
    if (tx.body.transaction_details.gross_amount !== 50000) throw new Error("gross_amount " + tx.body.transaction_details.gross_amount);
    if (!/^ytk-[0-9a-f-]{36}$/.test(orderRef)) throw new Error("order_id Midtrans " + orderRef);
    if (new URL(tx.finish).pathname !== `/checkout/${reviewOrder}`) throw new Error("finish " + tx.finish);
    if ("customer_details" in tx.body) throw new Error("data pribadi terkirim ke Midtrans");
    if (!/notifikasi HTTP 200/.test(result)) throw new Error("webhook expire: " + result);
    const p = await pays(reviewOrder);
    if (p.length !== 1 || p[0].status !== "EXPIRED" || p[0].provider !== "midtrans") throw new Error(JSON.stringify(p));
    if ((await orderRow(reviewOrder)) !== "PENDING_PAYMENT") throw new Error("pesanan ikut kedaluwarsa");
    const t = await page.innerText("main");
    if (!t.includes("Pembayaran sebelumnya di Midtrans belum berhasil") || !t.includes("Bayar dengan Midtrans")) throw new Error("tidak dapat bayar ulang: " + t.slice(0, 500));
    if (t.includes("Pembayaran dikonfirmasi")) throw new Error("parameter URL dianggap lunas");
    await shot("midtrans-02-kedaluwarsa");
  });

  let ref2 = "";
  await step(tag("bayar ulang: transaksi Snap baru; notifikasi palsu (tanda tangan salah, atau sah tetapi API status pending) tidak melunasi"), async () => {
    const pay = page.locator("button:has-text('Bayar dengan Midtrans')");
    await Promise.all([page.waitForURL(/\/snap\/v4\/redirection\//, { timeout: 30000 }), pay.click()]);
    ref2 = await page.getAttribute("[data-order]", "data-order");
    if (!ref2 || midtrans.txs.size < 1 || ref2 === [...(await pays(reviewOrder))].find((x) => x.status === "EXPIRED").provider_ref) throw new Error("transaksi bayar ulang tidak baru");
    // Penyerang tanpa server key: 401.
    const bad = await midtrans.notify(ref2, { status: "settlement", key: "SB-Mid-server-kunci-penyerang" });
    if (bad.httpStatus !== 401) throw new Error("tanda tangan salah diterima: " + bad.httpStatus);
    // Tanda tangan sah (kunci bocor) tetapi API status Midtrans belum lunas: tidak lunas.
    midtrans.setStatus(ref2, "pending");
    const forged = await midtrans.notify(ref2, { status: "settlement" });
    if (forged.httpStatus !== 200 || !forged.body.includes("RECORDED")) throw new Error("notifikasi palsu: " + forged.httpStatus + " " + forged.body);
    if ((await orderRow(reviewOrder)) !== "PENDING_PAYMENT") throw new Error("notifikasi palsu melunasi pesanan");
  });

  await step(tag("kembali ke checkout: 'Lanjutkan pembayaran' + 'Perbarui status'; Perbarui status tidak melunasi transaksi pending"), async () => {
    await page.goto(base + `/checkout/${reviewOrder}`);
    const t = await page.innerText("main");
    if (!t.includes("Lanjutkan pembayaran di Midtrans") || !t.includes("Perbarui status")) throw new Error(t.slice(0, 500));
    await submit(page, page.locator("button:has-text('Perbarui status')"));
    const after = await page.innerText("main");
    if (!after.includes("Status sudah diperiksa ulang ke Midtrans") || after.includes("Pembayaran dikonfirmasi")) throw new Error(after.slice(0, 500));
    await layoutOk();
    await shot("midtrans-03-menunggu");
  });

  await step(tag("lanjutkan memakai transaksi Snap yang sama; lunas lewat webhook terverifikasi → Legal Review terbuka"), async () => {
    const before = midtrans.txs.size;
    const { orderRef, result } = await payWithMidtrans(page, base);
    if (orderRef !== ref2 || midtrans.txs.size !== before) throw new Error("klik ulang membuat transaksi Snap baru");
    if (!/notifikasi HTTP 200/.test(result)) throw new Error("webhook: " + result);
    const t = await page.innerText("main");
    if (!t.includes("Pembayaran dikonfirmasi") || !t.includes("Buka Legal Review Saya")) throw new Error(t.slice(0, 500));
    // Notifikasi ulang (retry Midtrans) tidak mengaktifkan dua kali.
    const again = await midtrans.notify(ref2);
    if (again.httpStatus !== 200 || !again.body.includes("DUPLICATE")) throw new Error("retry: " + again.httpStatus + again.body);
    const rr = (await db.query("select status from review_requests where order_id = $1", [reviewOrder])).rows;
    if (rr.length !== 1) throw new Error("permintaan pemeriksaan: " + JSON.stringify(rr));
    await page.click("a:has-text('Buka Legal Review Saya')");
    await page.waitForURL(/\/reviews/);
    if (!(await page.innerText("main")).includes("Perjanjian Kerahasiaan")) throw new Error("Legal Review tidak tampil di daftar");
    await shot("midtrans-04-lunas");
  });

  await step(tag("Membership: parameter status di URL kembali tidak melunasi; 'Perbarui status' melunasi bila webhook tidak datang"), async () => {
    await page.goto(base + "/membership");
    await Promise.all([page.waitForURL(/\/checkout\/[0-9a-f-]{36}$/, { timeout: 30000 }), page.click("button:has-text('Lanjut ke pembayaran')")]);
    const mOrder = orderOf();
    await page.goto(base + `/checkout/${mOrder}?order_id=ytk-palsu&status_code=200&transaction_status=settlement`);
    if ((await page.innerText("main")).includes("Pembayaran dikonfirmasi")) throw new Error("parameter URL melunasi");
    const { result } = await payWithMidtrans(page, base, "Bayar tanpa notifikasi");
    if (!/tanpa notifikasi/.test(result)) throw new Error(result);
    if ((await orderRow(mOrder)) !== "PENDING_PAYMENT") throw new Error("lunas tanpa konfirmasi");
    if ((await page.innerText("main")).includes("Pembayaran dikonfirmasi")) throw new Error("finish dengan transaction_status=settlement dianggap lunas");
    await submit(page, page.locator("button:has-text('Perbarui status')"));
    if (!(await page.innerText("main")).includes("Pembayaran dikonfirmasi")) throw new Error("Perbarui status tidak melunasi");
    if ((await orderRow(mOrder)) !== "PAID") throw new Error("DB tidak lunas");
  });

  await step(tag("transfer manual lama: instruksi tetap tampil di checkout dan admin tetap dapat mengonfirmasi"), async () => {
    await page.goto(base + "/membership");
    await Promise.all([page.waitForURL(/\/checkout\/[0-9a-f-]{36}$/, { timeout: 30000 }), page.click("button:has-text('Perpanjang Membership'), button:has-text('Lanjut ke pembayaran')")]);
    const legacy = orderOf();
    const owner = (await db.query("select user_id from orders where id = $1", [legacy])).rows[0].user_id;
    const pid = (await db.query("select create_payment($1, $2, 'manual', $3, now()) as id", [owner, legacy, `manual-lama-${n}`])).rows[0].id;
    await page.reload();
    const t = await page.innerText("main");
    if (!t.includes("Transfer bank (pesanan lama)") || !t.includes("Transfer ke rekening uji 000-000")) throw new Error(t.slice(0, 500));
    const admin = await newActor("admin-midtrans");
    await register(admin.page, base, `admin-midtrans+${n}@example.com`);
    await db.query("insert into public.user_roles (user_id, role) select id, 'platform_admin' from auth.users where email = $1 on conflict do nothing", [`admin-midtrans+${n}@example.com`]);
    await admin.page.goto(base + "/admin/payments");
    const code = `YK-${pid.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
    const f = admin.page.locator(`section[aria-labelledby=menunggu-h] form:has-text("${code}")`);
    await f.locator("input[name=bankRef]").fill(`BANK-LAMA-${vp.name}`);
    await submit(admin.page, f.locator("button:has-text('Konfirmasi pembayaran')"));
    if ((await orderRow(legacy)) !== "PAID") throw new Error("konfirmasi manual lama gagal");
  });

  await step(tag("tanpa error konsol/halaman (CSP)"), async () => {
    const real = issues.filter((m) => !/Failed to load resource.*(favicon|_next\/static)/i.test(m) && !/status of (404|5\d\d|429)/.test(m));
    if (real.length) throw new Error(real.slice(0, 2).join(" || "));
  });
}

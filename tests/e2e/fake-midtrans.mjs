// Midtrans palsu untuk E2E (Task 21). Hanya untuk pengujian. Bentuk mengikuti asumsi di src/lib/billing/midtrans.ts:
//   POST /snap/v1/transactions (Basic auth "<server key>:") → 201 { token, redirect_url }
//   GET  /snap/v4/redirection/<token>   → halaman bayar simulasi (tombol berhasil / kedaluwarsa / gagal / tanpa notifikasi)
//   GET  /v2/<order_id>/status          → status transaksi ({ status_code: "404" } bila belum ada transaksi)
// Halaman simulasi mengirim HTTP Notification bertanda tangan SHA512(order_id+status_code+gross_amount+server key) ke webhook
// aplikasi, lalu menampilkan tautan "Kembali ke Yuktanya" (callbacks.finish + parameter status seperti Midtrans asli).
import http from "node:http";
import { createHash, randomUUID } from "node:crypto";

export const MIDTRANS_TEST_KEY = "SB-Mid-server-E2E-uji-rahasia";
const CODES = { settlement: "200", capture: "200", pending: "201", deny: "202", cancel: "202", expire: "407", failure: "202" };

export function startFakeMidtrans({ port, appBase, serverKey = MIDTRANS_TEST_KEY }) {
  const txs = new Map(); // order_id -> { orderId, token, gross, body, status, transactionId, finish }
  const byToken = new Map();
  const notifications = []; // { orderId, status, httpStatus }
  const origin = `http://127.0.0.1:${port}`;
  const authOk = (req) => req.headers.authorization === `Basic ${Buffer.from(`${serverKey}:`).toString("base64")}`;
  const body = (req) => new Promise((r) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => r(d)); });
  const send = (res, code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
  const html = (res, inner) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(`<!doctype html><html lang="id"><head><meta name="viewport" content="width=device-width"><title>Midtrans (simulasi)</title></head><body><main>${inner}</main></body></html>`); };
  const gross = (tx) => `${tx.gross}.00`;
  const sign = (orderId, code, g, key = serverKey) => createHash("sha512").update(`${orderId}${code}${g}${key}`).digest("hex");

  // Notifikasi ke webhook aplikasi. Opsi untuk tes notifikasi palsu: key (tanda tangan dengan kunci lain), status/gross badan.
  async function notify(orderId, { status, key, grossAmount } = {}) {
    const tx = txs.get(orderId);
    const st = status ?? tx?.status ?? "settlement";
    const g = grossAmount ?? (tx ? gross(tx) : "50000.00");
    const code = CODES[st] ?? "201";
    const payload = { order_id: orderId, status_code: code, gross_amount: g, transaction_status: st, transaction_id: tx?.transactionId ?? randomUUID(), fraud_status: "accept", currency: "IDR", signature_key: sign(orderId, code, g, key) };
    const r = await fetch(`${appBase}/api/payments/webhook/midtrans`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const entry = { orderId, status: st, httpStatus: r.status, body: await r.text() };
    notifications.push(entry);
    return entry;
  }
  const setStatus = (orderId, status) => {
    const tx = txs.get(orderId);
    if (!tx) throw new Error("transaksi palsu tidak ada: " + orderId);
    tx.status = status;
    tx.transactionId ??= randomUUID();
  };

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, origin);
      if (url.pathname === "/snap/v1/transactions" && req.method === "POST") {
        if (!authOk(req)) return send(res, 401, { error_messages: ["Access denied due to unauthorized transaction, please check client or server key"] });
        const b = JSON.parse(await body(req));
        const orderId = b?.transaction_details?.order_id;
        if (txs.has(orderId)) return send(res, 400, { error_messages: ["transaction_details.order_id sudah digunakan"] });
        const token = randomUUID();
        const tx = { orderId, token, gross: b.transaction_details.gross_amount, body: b, status: null, transactionId: null, finish: b?.callbacks?.finish };
        txs.set(orderId, tx);
        byToken.set(token, tx);
        return send(res, 201, { token, redirect_url: `${origin}/snap/v4/redirection/${token}` });
      }
      const page = /^\/snap\/v4\/redirection\/([0-9a-f-]+)$/.exec(url.pathname);
      if (page && req.method === "GET") {
        const tx = byToken.get(page[1]);
        if (!tx) return html(res, "<p>Token tidak dikenal.</p>");
        const btn = (a, label) => `<form method="post" action="/simulate/${tx.token}/${a}"><button type="submit" style="min-height:48px">${label}</button></form>`;
        return html(res, `<h1>Halaman bayar Midtrans (simulasi)</h1><p data-order="${tx.orderId}">Jumlah: Rp${tx.gross}</p>${btn("settlement", "Bayar (berhasil)")}${btn("expire", "Biarkan kedaluwarsa")}${btn("deny", "Pembayaran ditolak")}${btn("settlement-silent", "Bayar tanpa notifikasi")}`);
      }
      const sim = /^\/simulate\/([0-9a-f-]+)\/([a-z-]+)$/.exec(url.pathname);
      if (sim && req.method === "POST") {
        const tx = byToken.get(sim[1]);
        if (!tx) return html(res, "<p>Token tidak dikenal.</p>");
        const silent = sim[2].endsWith("-silent");
        const st = sim[2].replace(/-silent$/, "");
        setStatus(tx.orderId, st);
        const n = silent ? null : await notify(tx.orderId);
        const back = `${tx.finish}?order_id=${encodeURIComponent(tx.orderId)}&status_code=${CODES[st]}&transaction_status=${st}`;
        return html(res, `<p id="hasil">Simulasi ${st}${n ? `, notifikasi HTTP ${n.httpStatus}` : ", tanpa notifikasi"}.</p><a id="kembali" href="${back}">Kembali ke Yuktanya</a>`);
      }
      const st = /^\/v2\/([^/]+)\/status$/.exec(url.pathname);
      if (st && req.method === "GET") {
        if (!authOk(req)) return send(res, 401, { status_code: "401", status_message: "Unauthorized" });
        const tx = txs.get(decodeURIComponent(st[1]));
        if (!tx || !tx.status) return send(res, 404, { status_code: "404", status_message: "Transaction doesn't exist." });
        return send(res, 200, {
          status_code: CODES[tx.status] ?? "201", transaction_status: tx.status, order_id: tx.orderId, transaction_id: tx.transactionId,
          gross_amount: gross(tx), currency: "IDR", fraud_status: "accept", payment_type: "bank_transfer",
        });
      }
      send(res, 404, { status_code: "404" });
    } catch (e) {
      send(res, 500, { error: String(e) });
    }
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({
    origin, txs, notifications, notify, setStatus,
    // Transaksi Snap terakhir yang dibuat (opsional: pertama yang cocok dengan predikat).
    last: (pred = () => true) => [...txs.values()].reverse().find(pred),
    close: () => new Promise((r) => server.close(() => r())),
  })));
}

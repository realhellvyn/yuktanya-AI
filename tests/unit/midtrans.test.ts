import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  MIDTRANS_FORM_ACTION_ORIGINS, MIN_PAYMENT_MINUTES, MidtransError, createSnapTransaction, eventIdFor, getTransactionStatus, keyShape, mapStatus,
  midtransConfig, parseAmount, verifyNotificationSignature,
} from "@/lib/billing/midtrans";

const KEY = "SB-Mid-server-UJI-rahasia-123";
const cfg = midtransConfig({ MIDTRANS_SERVER_KEY: KEY, MIDTRANS_ENV: "sandbox" })!;
const NOW = new Date("2026-10-17T05:00:00Z");
const REF = "ytk-0b9c0e2a-3f4d-4e5f-8a6b-7c8d9e0f1a2b";

type Call = { url: string; init: RequestInit };
function fakeFetch(...responses: (Response | Error)[]) {
  const calls: Call[] = [];
  let i = 0;
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = responses[Math.min(i++, responses.length - 1)];
    if (next instanceof Error) throw next;
    return next.clone();
  }) as unknown as typeof fetch;
  return { impl, calls };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const basic = `Basic ${Buffer.from(`${KEY}:`).toString("base64")}`;
const errCode = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof MidtransError) {
      expect(e.message).not.toContain(KEY);
      return e.code;
    }
    return `OTHER:${String(e)}`;
  }
  return "NO_ERROR";
};

describe("midtransConfig", () => {
  it("tanpa server key → null (pembayaran belum tersedia)", () => {
    expect(midtransConfig({})).toBeNull();
    expect(midtransConfig({ MIDTRANS_SERVER_KEY: "   ", MIDTRANS_ENV: "production" })).toBeNull();
  });

  it("hanya 'production' yang memakai URL produksi; nilai lain (kosong, salah ketik) = sandbox", () => {
    for (const v of [undefined, "", "sandbox", "Production", "prod", "staging"]) {
      const c = midtransConfig({ MIDTRANS_SERVER_KEY: KEY, MIDTRANS_ENV: v })!;
      expect([c.mode, c.snapUrl, c.apiBase], String(v)).toEqual(["sandbox", "https://app.sandbox.midtrans.com/snap/v1/transactions", "https://api.sandbox.midtrans.com"]);
      expect(c.redirectOrigins).toEqual(["https://app.sandbox.midtrans.com"]);
    }
    const p = midtransConfig({ MIDTRANS_SERVER_KEY: KEY, MIDTRANS_ENV: " production " })!;
    expect([p.mode, p.snapUrl, p.apiBase, p.redirectOrigins]).toEqual(["production", "https://app.midtrans.com/snap/v1/transactions", "https://api.midtrans.com", ["https://app.midtrans.com"]]);
  });

  it("server key dipangkas; MIDTRANS_TEST_BASE_URL hanya berlaku untuk alamat loopback (server palsu di tes)", () => {
    expect(midtransConfig({ MIDTRANS_SERVER_KEY: ` ${KEY}\n` })!.serverKey).toBe(KEY);
    const t = midtransConfig({ MIDTRANS_SERVER_KEY: KEY, MIDTRANS_TEST_BASE_URL: "http://127.0.0.1:54997", NODE_ENV: "production" })!;
    expect([t.snapUrl, t.apiBase, t.redirectOrigins]).toEqual(["http://127.0.0.1:54997/snap/v1/transactions", "http://127.0.0.1:54997", ["http://127.0.0.1:54997"]]);
    for (const bad of ["https://evil.example", "http://10.0.0.1:80", "ftp://127.0.0.1", "bukan url"]) {
      expect(midtransConfig({ MIDTRANS_SERVER_KEY: KEY, MIDTRANS_TEST_BASE_URL: bad })!.apiBase, bad).toBe("https://api.sandbox.midtrans.com");
    }
  });

  it("salah salin yang tidak terlihat dibersihkan: kutip pembungkus, spasi/baris baru di tengah, karakter lebar-nol, awalan NAMA=", () => {
    for (const raw of [`"${KEY}"`, `'${KEY}'`, `${KEY.slice(0, 10)}\n${KEY.slice(10)}`, `\uFEFF${KEY}\u200B`, `MIDTRANS_SERVER_KEY=${KEY}`, ` "MIDTRANS_SERVER_KEY=${KEY}" `]) {
      expect(midtransConfig({ MIDTRANS_SERVER_KEY: raw })!.serverKey, JSON.stringify(raw)).toBe(KEY);
    }
    expect(midtransConfig({ MIDTRANS_SERVER_KEY: `""` })).toBeNull();
  });

  it("keyShape hanya menyebut jenis awalan dan panjang, tidak pernah isi kunci", () => {
    expect(keyShape(KEY)).toBe(`SB-Mid-server len=${KEY.length}`);
    expect(keyShape("Mid-server-abcdefghijkl")).toBe("Mid-server len=23");
    expect(keyShape("SB-Mid-client-abcdefgh")).toBe("SB-Mid-client len=22");
    expect(keyShape("Mid-client-abcdefgh")).toBe("Mid-client len=19");
    expect(keyShape("abcdefghijklmnop")).toBe("lain len=16");
    expect(keyShape(KEY)).not.toContain("UJI");
  });

  it("MIDTRANS_TEST_BASE_URL diabaikan di Vercel (VERCEL atau VERCEL_ENV ada), walau loopback; harness lokal tetap memakainya", () => {
    const local = { MIDTRANS_SERVER_KEY: KEY, MIDTRANS_TEST_BASE_URL: "http://127.0.0.1:54997", NODE_ENV: "production" };
    expect(midtransConfig(local)!.apiBase).toBe("http://127.0.0.1:54997");
    for (const v of [{ VERCEL: "1" }, { VERCEL_ENV: "production" }, { VERCEL_ENV: "preview" }]) {
      const c = midtransConfig({ ...local, ...v })!;
      expect([c.snapUrl, c.apiBase, c.redirectOrigins], JSON.stringify(v)).toEqual(["https://app.sandbox.midtrans.com/snap/v1/transactions", "https://api.sandbox.midtrans.com", ["https://app.sandbox.midtrans.com"]]);
    }
    expect(midtransConfig({ ...local, MIDTRANS_ENV: "production", VERCEL: "1" })!.apiBase).toBe("https://api.midtrans.com");
  });

  it("asal form-action CSP hanya dua domain halaman bayar Midtrans", () => {
    expect(MIDTRANS_FORM_ACTION_ORIGINS).toEqual(["https://app.midtrans.com", "https://app.sandbox.midtrans.com"]);
  });
});

describe("createSnapTransaction", () => {
  const input = { providerRef: REF, amountIdr: 50000, itemId: "STANDARD_REVIEW", itemName: "Legal Review Yuktanya", finishUrl: "https://yuktanya.com/checkout/o-1", expiresAt: new Date(NOW.getTime() + 90.5 * 60_000), now: NOW };

  it("POST Snap dengan Basic auth server key; jumlah, referensi, finish, dan kedaluwarsa dari server; tanpa data pribadi", async () => {
    const f = fakeFetch(json({ token: "tok-1", redirect_url: "https://app.sandbox.midtrans.com/snap/v4/redirection/tok-1" }, 201));
    const r = await createSnapTransaction(cfg, input, f.impl);
    expect(r).toEqual({ token: "tok-1", redirectUrl: "https://app.sandbox.midtrans.com/snap/v4/redirection/tok-1" });
    const [c] = f.calls;
    expect(c.url).toBe("https://app.sandbox.midtrans.com/snap/v1/transactions");
    expect(c.init.method).toBe("POST");
    const h = new Headers(c.init.headers);
    expect(h.get("authorization")).toBe(basic);
    expect(h.get("content-type")).toBe("application/json");
    expect(c.init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(c.init.body))).toEqual({
      transaction_details: { order_id: REF, gross_amount: 50000 },
      item_details: [{ id: "STANDARD_REVIEW", price: 50000, quantity: 1, name: "Legal Review Yuktanya" }],
      callbacks: { finish: "https://yuktanya.com/checkout/o-1" },
      expiry: { start_time: "2026-10-17 12:00:00 +0700", unit: "minute", duration: 90 },
      credit_card: { secure: true },
    });
  });

  it("sisa waktu pesanan < MIN_PAYMENT_MINUTES (2 menit) → REJECTED tanpa memanggil Snap; nama item dipotong 50 karakter", async () => {
    expect(MIN_PAYMENT_MINUTES).toBe(2);
    const none = fakeFetch(json({}, 201));
    expect(await errCode(createSnapTransaction(cfg, { ...input, expiresAt: new Date(NOW.getTime() + 119_000) }, none.impl))).toBe("REJECTED");
    expect(none.calls).toHaveLength(0);
    const f = fakeFetch(json({ token: "t", redirect_url: "https://app.sandbox.midtrans.com/snap/v4/redirection/t" }, 201));
    await createSnapTransaction(cfg, { ...input, itemName: "x".repeat(80), expiresAt: new Date(NOW.getTime() + 120_000) }, f.impl);
    const b = JSON.parse(String(f.calls[0].init.body));
    expect(b.expiry.duration).toBe(2);
    expect(b.item_details[0].name).toHaveLength(50);
  });

  it("galat Midtrans: 4xx → REJECTED, 5xx/jaringan → UNAVAILABLE, redirect ke domain lain → BAD_RESPONSE; pesan tanpa server key", async () => {
    expect(await errCode(createSnapTransaction(cfg, input, fakeFetch(json({ error_messages: ["transaction_details.order_id sudah digunakan"] }, 400)).impl))).toBe("REJECTED");
    expect(await errCode(createSnapTransaction(cfg, input, fakeFetch(json({ error_messages: ["Access denied"] }, 401)).impl))).toBe("REJECTED");
    // 401: pesan menyebut mode dan bentuk kunci (bukan isinya) agar salah pasang kunci/mode terlihat di log.
    const denied = await createSnapTransaction(cfg, input, fakeFetch(json({ error_messages: ["Access denied"] }, 401)).impl).catch((e: Error) => e.message);
    expect(denied).toContain(`mode=sandbox key=SB-Mid-server len=${KEY.length}`);
    expect(denied).not.toContain(KEY);
    expect(await errCode(createSnapTransaction(cfg, input, fakeFetch(new Response("x", { status: 503 })).impl))).toBe("UNAVAILABLE");
    expect(await errCode(createSnapTransaction(cfg, input, fakeFetch(new TypeError("fetch failed")).impl))).toBe("UNAVAILABLE");
    expect(await errCode(createSnapTransaction(cfg, input, fakeFetch(new DOMException("timeout", "TimeoutError")).impl))).toBe("UNAVAILABLE");
    expect(await errCode(createSnapTransaction(cfg, input, fakeFetch(json({ token: "t", redirect_url: "https://evil.example/pay" }, 201)).impl))).toBe("BAD_RESPONSE");
    expect(await errCode(createSnapTransaction(cfg, input, fakeFetch(new Response("bukan json", { status: 201 })).impl))).toBe("BAD_RESPONSE");
  });
});

describe("getTransactionStatus", () => {
  const settled = { status_code: "200", transaction_status: "settlement", order_id: REF, transaction_id: "tx-1", gross_amount: "50000.00", currency: "IDR", fraud_status: "accept" };

  it("GET /v2/<order_id>/status dengan Basic auth; mengembalikan status terkonfirmasi", async () => {
    const f = fakeFetch(json(settled));
    expect(await getTransactionStatus(cfg, REF, f.impl)).toEqual({
      orderId: REF, transactionId: "tx-1", transactionStatus: "settlement", fraudStatus: "accept", grossAmount: "50000.00", currency: "IDR",
    });
    expect(f.calls[0].url).toBe(`https://api.sandbox.midtrans.com/v2/${REF}/status`);
    expect(f.calls[0].init.method ?? "GET").toBe("GET");
    expect(new Headers(f.calls[0].init.headers).get("authorization")).toBe(basic);
  });

  it("transaksi tidak dikenal (HTTP 404 atau status_code 404) → null; expire (status_code 407) tetap dikembalikan", async () => {
    expect(await getTransactionStatus(cfg, REF, fakeFetch(json({ status_code: "404", status_message: "Transaction doesn't exist." })).impl)).toBeNull();
    expect(await getTransactionStatus(cfg, REF, fakeFetch(json({ status_code: "404" }, 404)).impl)).toBeNull();
    const e = await getTransactionStatus(cfg, REF, fakeFetch(json({ ...settled, status_code: "407", transaction_status: "expire" })).impl);
    expect(e?.transactionStatus).toBe("expire");
  });

  it("5xx, 401 (kunci salah), jaringan → UNAVAILABLE; badan tidak valid atau order_id lain → BAD_RESPONSE", async () => {
    expect(await errCode(getTransactionStatus(cfg, REF, fakeFetch(new Response("x", { status: 502 })).impl))).toBe("UNAVAILABLE");
    expect(await errCode(getTransactionStatus(cfg, REF, fakeFetch(json({ status_code: "401" }, 401)).impl))).toBe("UNAVAILABLE");
    expect(await errCode(getTransactionStatus(cfg, REF, fakeFetch(new TypeError("fetch failed")).impl))).toBe("UNAVAILABLE");
    expect(await errCode(getTransactionStatus(cfg, REF, fakeFetch(new Response("<html>", { status: 200 })).impl))).toBe("BAD_RESPONSE");
    expect(await errCode(getTransactionStatus(cfg, REF, fakeFetch(json({ ...settled, order_id: "ytk-lain" })).impl))).toBe("BAD_RESPONSE");
    expect(await errCode(getTransactionStatus(cfg, REF, fakeFetch(json({ ...settled, transaction_id: undefined })).impl))).toBe("BAD_RESPONSE");
  });

  it("order_id dikodekan di URL", async () => {
    const f = fakeFetch(json({ status_code: "404" }));
    await getTransactionStatus(cfg, "a/../b", f.impl);
    expect(f.calls[0].url).toBe("https://api.sandbox.midtrans.com/v2/a%2F..%2Fb/status");
  });
});

describe("tanda tangan notifikasi", () => {
  const body = { order_id: REF, status_code: "200", gross_amount: "50000.00" };
  const sig = createHash("sha512").update(`${REF}20050000.00${KEY}`).digest("hex");

  it("SHA512(order_id + status_code + gross_amount + server key) diterima", () => {
    expect(verifyNotificationSignature({ ...body, signature_key: sig }, KEY)).toBe(true);
  });

  it("tanda tangan salah, panjang beda, field hilang, kunci lain, atau bukan string → ditolak", () => {
    expect(verifyNotificationSignature({ ...body, signature_key: sig.replace(/.$/, (c) => (c === "0" ? "1" : "0")) }, KEY)).toBe(false);
    expect(verifyNotificationSignature({ ...body, signature_key: sig.slice(2) }, KEY)).toBe(false);
    expect(verifyNotificationSignature({ ...body, signature_key: sig.toUpperCase() }, KEY)).toBe(false);
    expect(verifyNotificationSignature({ ...body, gross_amount: "50001.00", signature_key: sig }, KEY)).toBe(false);
    expect(verifyNotificationSignature({ ...body, signature_key: sig }, "SB-Mid-server-kunci-lain")).toBe(false);
    expect(verifyNotificationSignature({ order_id: REF, status_code: "200", signature_key: sig }, KEY)).toBe(false);
    expect(verifyNotificationSignature({ ...body, status_code: 200, signature_key: sig }, KEY)).toBe(false);
    expect(verifyNotificationSignature(null, KEY)).toBe(false);
    expect(verifyNotificationSignature({ ...body, signature_key: sig }, "")).toBe(false);
  });
});

describe("pemetaan status dan jumlah", () => {
  it("settlement dan capture+accept → lunas; pending/challenge/authorize/refund → catat; expire → EXPIRED; cancel/deny/failure → FAILED", () => {
    const m = (t: string, f?: string) => mapStatus(t, f);
    expect(m("settlement")).toEqual({ kind: "SETTLE" });
    expect(m("capture", "accept")).toEqual({ kind: "SETTLE" });
    expect(m("capture", "challenge")).toEqual({ kind: "RECORD" });
    expect(m("capture")).toEqual({ kind: "RECORD" });
    for (const t of ["pending", "authorize", "refund", "partial_refund", "chargeback", "partial_chargeback", "aneh"]) expect(m(t), t).toEqual({ kind: "RECORD" });
    expect(m("expire")).toEqual({ kind: "FAIL", status: "EXPIRED" });
    for (const t of ["cancel", "deny", "failure"]) expect(m(t), t).toEqual({ kind: "FAIL", status: "FAILED" });
  });

  it("event id = transaction_id:status (+ fraud_status untuk capture), sehingga challenge lalu accept tidak dianggap duplikat", () => {
    expect(eventIdFor({ transactionId: "tx-1", transactionStatus: "settlement", fraudStatus: "accept" })).toBe("tx-1:settlement");
    expect(eventIdFor({ transactionId: "tx-1", transactionStatus: "capture", fraudStatus: "challenge" })).toBe("tx-1:capture:challenge");
    expect(eventIdFor({ transactionId: "tx-1", transactionStatus: "capture", fraudStatus: "accept" })).toBe("tx-1:capture:accept");
  });

  it("gross_amount Rupiah bulat saja; pecahan, negatif, nol, atau bukan angka → null", () => {
    expect(parseAmount("50000.00")).toBe(50000);
    expect(parseAmount("50000")).toBe(50000);
    for (const v of ["50000.50", "-5", "0", "0.00", "abc", "", "1e5", " 50000"]) expect(parseAmount(v), v).toBeNull();
  });
});

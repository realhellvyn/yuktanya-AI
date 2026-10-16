// Supabase Auth/PostgREST palsu minimal untuk E2E lokal (tanpa Docker). Hanya untuk pengujian; bukan keamanan.
import http from "node:http";
import { createRequire } from "node:module";
import { randomUUID, createHmac } from "node:crypto";
const require = createRequire(import.meta.url);
const { Pool } = require("pg");

const b64 = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
const SECRET = "e2e-secret";
export const SERVICE_KEY = "service-e2e";
const sign = (payload) => {
  const h = b64({ alg: "HS256", typ: "JWT" }), p = b64(payload);
  return `${h}.${p}.${createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url")}`;
};
const verify = (t) => {
  const [h, p, s] = String(t ?? "").split(".");
  if (!s || createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url") !== s) return null;
  const pl = JSON.parse(Buffer.from(p, "base64url").toString());
  return pl.exp * 1000 > Date.now() ? pl : null;
};

export function startFakeSupabase({ databaseUrl, port }) {
  const pool = new Pool({ connectionString: databaseUrl, max: 3 });
  const users = new Map(); // email -> { id, email, password }
  const outbox = []; // email palsu yang "terkirim": { kind: "recover" | "resend", email }
  const codes = new Map(); // kode PKCE pemulihan -> email
  const deleted = []; // akun yang dihapus lewat Admin API: { id, email, soft }
  const session = (u, method = "password") => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const user = { id: u.id, aud: "authenticated", role: "authenticated", email: u.email, app_metadata: { provider: "email" }, user_metadata: {}, created_at: new Date().toISOString() };
    return { access_token: sign({ sub: u.id, email: u.email, role: "authenticated", aud: "authenticated", exp, amr: [{ method, timestamp: Math.floor(Date.now() / 1000) }] }), token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: sign({ sub: u.id, rt: true, exp: exp + 86400, method }), user };
  };
  const body = (req) => new Promise((r) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => r(d ? JSON.parse(d) : {})); });
  const send = (res, code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://x");
      if (url.pathname === "/auth/v1/signup" && req.method === "POST") {
        const { email, password } = await body(req);
        if (users.has(email)) return send(res, 400, { code: 400, error_code: "user_already_exists", msg: "User already registered" });
        const id = randomUUID();
        await pool.query("insert into auth.users (id, email) values ($1, $2)", [id, email]);
        const u = { id, email, password };
        users.set(email, u);
        return send(res, 200, session(u));
      }
      if (url.pathname === "/auth/v1/token" && req.method === "POST") {
        const b = await body(req);
        if (url.searchParams.get("grant_type") === "refresh_token") {
          const pl = verify(b.refresh_token);
          const u = pl && [...users.values()].find((x) => x.id === pl.sub);
          return u ? send(res, 200, session(u, pl.method)) : send(res, 400, { error_code: "refresh_token_not_found", msg: "bad refresh" });
        }
        if (url.searchParams.get("grant_type") === "pkce") {
          // Tukar kode dari tautan email pemulihan: sesi yang lahir di sini bertanda amr "recovery".
          const email = codes.get(b.auth_code);
          const u = email && users.get(email);
          return u ? send(res, 200, session(u, "recovery")) : send(res, 400, { error_code: "flow_state_not_found", msg: "bad code" });
        }
        const u = users.get(b.email);
        return u && u.password === b.password ? send(res, 200, session(u)) : send(res, 400, { error_code: "invalid_credentials", msg: "Invalid login credentials" });
      }
      // Lupa kata sandi / kirim ulang konfirmasi: selalu 200 (seperti Supabase, tidak membocorkan keberadaan akun).
      if (url.pathname === "/auth/v1/recover" && req.method === "POST") {
        const email = (await body(req)).email;
        const code = randomUUID();
        if (users.has(email)) codes.set(code, email);
        outbox.push({ kind: "recover", email, code });
        return send(res, 200, {});
      }
      if (url.pathname === "/auth/v1/resend" && req.method === "POST") {
        outbox.push({ kind: "resend", email: (await body(req)).email });
        return send(res, 200, { message_id: randomUUID() });
      }
      if (url.pathname === "/auth/v1/user" && req.method === "PUT") {
        const pl = verify((req.headers.authorization ?? "").replace(/^Bearer /, ""));
        const u = pl && [...users.values()].find((x) => x.id === pl.sub);
        if (!u) return send(res, 401, { code: 401, error_code: "bad_jwt", msg: "invalid JWT" });
        const { password } = await body(req);
        if (password && password === u.password) return send(res, 422, { code: 422, error_code: "same_password", msg: "New password should be different from the old password." });
        if (password) u.password = password;
        return send(res, 200, session(u).user);
      }
      if (url.pathname === "/auth/v1/user") {
        const pl = verify((req.headers.authorization ?? "").replace(/^Bearer /, ""));
        const u = pl && [...users.values()].find((x) => x.id === pl.sub);
        return u ? send(res, 200, session(u).user) : send(res, 401, { code: 401, error_code: "bad_jwt", msg: "invalid JWT" });
      }
      if (url.pathname === "/auth/v1/logout") return send(res, 204, {});
      // Admin API (service role): hapus akun. Meniru soft delete Supabase: login & identitas hilang, baris auth.users tetap
      // (ID tetap sebagai rujukan anonim untuk pesanan/pembayaran) dengan email dikosongkan.
      const adminUser = /^\/auth\/v1\/admin\/users\/([0-9a-f-]{36})$/.exec(url.pathname);
      if (adminUser && req.method === "DELETE") {
        if ((req.headers.authorization ?? "") !== `Bearer ${SERVICE_KEY}`) return send(res, 401, { code: 401, error_code: "not_admin", msg: "User not allowed" });
        const u = [...users.values()].find((x) => x.id === adminUser[1]);
        if (!u) return send(res, 404, { code: 404, error_code: "user_not_found", msg: "User not found" });
        users.delete(u.email);
        deleted.push({ id: u.id, email: u.email, soft: Boolean((await body(req)).should_soft_delete) });
        await pool.query("update auth.users set email = null where id = $1", [u.id]);
        return send(res, 200, session(u).user);
      }
      if (url.pathname === "/rest/v1/user_roles") {
        const pl = verify((req.headers.authorization ?? "").replace(/^Bearer /, ""));
        if (!pl) return send(res, 401, { message: "JWT" });
        const { rows } = await pool.query("select role from public.user_roles where user_id = $1", [pl.sub]);
        return send(res, 200, rows);
      }
      send(res, 404, { message: `fake: ${req.method} ${url.pathname}` });
    } catch (e) {
      send(res, 500, { message: String(e) });
    }
  });
  return new Promise((r) => server.listen(port, "127.0.0.1", () => r({ server, outbox, deleted, close: () => { server.close(); return pool.end(); } })));
}

// LLM palsu (pengganti FreeLLMAPI): menjawab JSON dari pesan terakhir pengguna lewat aturan sederhana, dan sengaja
// menambahkan satu nilai karangan (disputeCity) saat pesan tidak menyebut pengadilan, agar lapisan "hanya yang tertulis" teruji.
// control.fail = jumlah permintaan berikutnya yang dijawab 500 (untuk menguji kegagalan gateway).
const MONTH = { januari: 1, februari: 2, maret: 3, april: 4, mei: 5, juni: 6, juli: 7, agustus: 8, september: 9, oktober: 10, november: 11, desember: 12 };
export function startFakeLlm({ port }) {
  const seen = [];
  const control = { fail: 0 };
  const server = http.createServer(async (req, res) => {
    let d = "";
    for await (const c of req) d += c;
    const body = d ? JSON.parse(d) : {};
    seen.push({ path: req.url, model: body.model, auth: req.headers.authorization });
    if (control.fail > 0) {
      control.fail--;
      res.writeHead(500, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "gagal sengaja" }));
    }
    const msgs = body.messages ?? [];
    const last = String(msgs.filter((m) => m.role === "user").at(-1)?.content ?? "");
    const system = String(msgs[0]?.content ?? "");
    // Analisis awal AI (src/lib/ai/prereview.ts): balas JSON sesuai skema tiga larik. Teks dokumen ada di blok <<<DOKUMEN.
    if (system.includes("pertanyaanUntukPengacara")) {
      const doc = /<<<DOKUMEN\n([\s\S]*)\nDOKUMEN>>>/.exec(last)?.[1] ?? "";
      control.prereview = (control.prereview ?? 0) + 1;
      const report = {
        perhatian: [`Dokumen memuat ${doc.split(/\n\n/).length} bagian; belum ada batas tanggung jawab (contoh sintetis).`],
        belumJelas: ["Tanggal mulai dan cara pembayaran belum jelas."],
        pertanyaanUntukPengacara: ["Apakah perlu klausul denda keterlambatan?"],
      };
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ id: "fake-pre", choices: [{ message: { role: "assistant", content: JSON.stringify(report) } }] }));
    }
    // Pemilih dokumen "Saya belum tahu" (src/lib/ai/template-chooser.ts): aturan kata kunci yang deterministik.
    // "kuasa" sengaja dijawab dengan dokumen karangan (SURAT_KUASA) agar penolakan pilihan di luar katalog teruji.
    if (system.includes("memilih jenis dokumen di Yuktanya")) {
      const pick = /pinjam|minjam|utang|hutang/i.test(last) ? ["UTANG_PIUTANG", "Sepertinya Anda membutuhkan Surat Utang Piutang, karena ada uang yang dipinjamkan."]
        : /rahasia/i.test(last) ? ["NDA", "Sepertinya Anda membutuhkan Perjanjian Kerahasiaan (NDA)."]
        : /kerja sama|kerjasama|bermitra/i.test(last) ? ["PKS", "Sepertinya Anda membutuhkan Perjanjian Kerja Sama."]
        : /kuasa/i.test(last) ? ["SURAT_KUASA", "Anda membutuhkan Surat Kuasa."]
        : /cerai|warisan|digugat|pidana/i.test(last) ? ["KASUS_KHUSUS", "Keperluan ini sebaiknya dinilai khusus oleh firma hukum."]
        : [null, "Boleh ceritakan lebih jelas: untuk keperluan apa dan dengan siapa?"];
      control.chooser = (control.chooser ?? 0) + 1;
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ id: "fake-pilih", choices: [{ message: { role: "assistant", content: JSON.stringify({ reply: pick[1], choice: pick[0] }) } }] }));
    }
    const person = (re) => re.exec(last)?.[1];
    const date = /Tanggal (\d{1,2}) ([A-Za-z]+) (\d{4})/.exec(last);
    const out = {
      disclosingParty: person(/Saya ([A-Z][a-z]+ [A-Z][a-z]+)/),
      receivingParty: person(/pihak kedua (?:jadi|adalah) ([A-Z][a-z]+ [A-Z][a-z]+)/) ?? person(/dari ([A-Z][a-z]+ [A-Z][a-z]+)/),
      confidentialInfo: person(/rahasia(?:nya)? (?:adalah )?(daftar pelanggan)/),
      termMonths: Number(person(/selama (\d+) bulan/)) || null,
      signingDate: date ? `${date[3]}-${String(MONTH[date[2].toLowerCase()]).padStart(2, "0")}-${date[1].padStart(2, "0")}` : null,
      purpose: person(/tujuannya ([^,.]+)/),
      disputeCity: person(/pengadilan (?:di )?([A-Z][a-z]+(?: [A-Z][a-z]+)?)/) ?? "Jakarta Selatan",
    };
    const missing = /belum terisi: ([^\n]+)/.exec(system)?.[1] ?? "";
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "fake-1", choices: [{ message: { role: "assistant", content: JSON.stringify({ reply: `Baik, saya catat. Tersisa: ${missing}`, fields: out }) } }] }));
  });
  return new Promise((r) => server.listen(port, "127.0.0.1", () => r({ seen, control, close: () => server.close() })));
}

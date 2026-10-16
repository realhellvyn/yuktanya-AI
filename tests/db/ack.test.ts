import { afterAll, describe, expect, it } from "vitest";
import { createPgDocumentsService } from "@/lib/documents/service";
import { createMockEmailSender, processOutbox } from "@/lib/vault/outbox";
import { createPgShareService } from "@/lib/vault/share";
import type { Data } from "@/lib/documents/types";
import { createUser, getPool } from "./helpers";

const pool = getPool();
afterAll(() => pool.end());
const T0 = new Date("2026-10-16T05:00:00Z");
const at = (min: number) => new Date(T0.getTime() + min * 60_000);
const docs = createPgDocumentsService(pool, { ALLOW_UNAPPROVED_TEMPLATES: "true", NODE_ENV: "test" });
const shares = createPgShareService(pool);
const key = () => `k-${Math.random().toString(36).slice(2)}-abcdef`;
const data: Data = {
  disclosingParty: "Sinta Dewi", receivingParty: "Budi Santoso", signingDate: "2026-10-16", confidentialInfo: "Info",
  purpose: "Evaluasi", termMonths: 24, disputeCity: "Jakarta",
};

async function sharedToken() {
  const u = await createUser(pool);
  await pool.query("insert into memberships(user_id, status, period_start, period_end) values ($1, 'ACTIVE', '2026-10-01', '2026-11-01')", [u]);
  const { documentId } = await docs.create(u, "NDA", key());
  await docs.saveDraft(u, documentId, data, 0);
  const r = await docs.freeze(u, documentId, key(), T0);
  if (!r.ok) throw new Error("freeze gagal");
  const s = await shares.create(u, r.versionId, 48 * 3600, T0);
  return { u, ...s, versionId: r.versionId };
}
const codeOf = (text: string) => /\b(\d{6})\b/.exec(text)![1];
const email = () => `pihak-${Math.random().toString(36).slice(2)}@example.test`;

async function requestAndRead(token: string, to: string, now: Date) {
  const sender = createMockEmailSender();
  expect(await shares.requestAck(token, to, now)).toBe("SENT");
  await processOutbox(pool, sender, now, 1000);
  const msg = sender.sent.find((m) => m.to === to.trim().toLowerCase());
  return { sender, code: msg ? codeOf(msg.text) : undefined, msg };
}

describe("konfirmasi baca", () => {
  it("alur penuh: kode diterima lewat email lalu diverifikasi sekali", async () => {
    const { token } = await sharedToken();
    const to = email();
    const { code, msg } = await requestAndRead(token, `  ${to.toUpperCase()} `, T0);
    expect(code).toMatch(/^\d{6}$/);
    expect(msg!.text).toContain("bukan tanda tangan elektronik");
    expect(await shares.verifyAck(token, to, code!, at(1))).toBe("VERIFIED");
    expect(await shares.verifyAck(token, to, code!, at(2))).toBe("INVALID");
    const rows = (await pool.query("select email from acknowledgements a join share_links s on s.id = a.share_id where s.token_hash = $1", [(await import("@/lib/vault/share")).hashToken(token)])).rows;
    expect(rows).toEqual([{ email: to }]);
  });

  it("kode salah 5 kali mengunci; kode benar sesudahnya tetap LOCKED", async () => {
    const { token } = await sharedToken();
    const to = email();
    const { code } = await requestAndRead(token, to, T0);
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) expect(await shares.verifyAck(token, to, wrong, at(1))).toBe("INVALID");
    expect(await shares.verifyAck(token, to, code!, at(2))).toBe("LOCKED");
  });

  it("kode kedaluwarsa setelah 10 menit", async () => {
    const { token } = await sharedToken();
    const to = email();
    const { code } = await requestAndRead(token, to, T0);
    expect(await shares.verifyAck(token, to, code!, at(11))).toBe("EXPIRED");
  });

  it("permintaan ke-6 dalam satu jam untuk share+email yang sama dibatasi", async () => {
    const { token } = await sharedToken();
    const to = email();
    for (let i = 0; i < 5; i++) expect(await shares.requestAck(token, to, at(i))).toBe("SENT");
    expect(await shares.requestAck(token, to, at(6))).toBe("RATE_LIMITED");
    expect(await shares.requestAck(token, to, at(61))).toBe("SENT");
  });

  it("share dicabut atau kedaluwarsa → NOT_FOUND untuk permintaan dan verifikasi", async () => {
    const a = await sharedToken();
    await shares.revoke(a.u, a.shareId, T0);
    expect(await shares.requestAck(a.token, email(), at(1))).toBe("NOT_FOUND");
    const b = await sharedToken();
    expect(await shares.requestAck(b.token, email(), new Date(T0.getTime() + 49 * 3600 * 1000))).toBe("NOT_FOUND");
    expect(await shares.verifyAck("x".repeat(43), email(), "123456", T0)).toBe("NOT_FOUND");
  });

  it("kode hanya tersimpan sebagai hash; payload dikosongkan setelah terkirim; tidak ada di share_events", async () => {
    const { token } = await sharedToken();
    const to = email();
    const { code } = await requestAndRead(token, to, T0);
    const ch = (await pool.query("select * from ack_challenges where email = $1", [to])).rows;
    expect(JSON.stringify(ch)).not.toContain(`"${code}"`);
    expect(ch[0].code_hash).toMatch(/^[0-9a-f]{64}$/);
    const ob = (await pool.query("select payload, status from outbox_events where kind = 'ack_code' and dedupe_key = $1", [`ack:${ch[0].id}`])).rows[0];
    expect(ob).toEqual({ payload: {}, status: "SENT" });
    expect(JSON.stringify((await pool.query("select * from share_events")).rows)).not.toContain(code!);
  });

  it("dua pemroses serentak tidak mengirim email ganda", async () => {
    const { token } = await sharedToken();
    const to = email();
    expect(await shares.requestAck(token, to, T0)).toBe("SENT");
    const sender = createMockEmailSender();
    await Promise.all([processOutbox(pool, sender, T0, 1000), processOutbox(pool, sender, T0, 1000)]);
    expect(sender.sent.filter((m) => m.to === to)).toHaveLength(1);
  });

  it("kegagalan pengirim → dijadwalkan ulang lalu terkirim pada percobaan berikutnya", async () => {
    const { token } = await sharedToken();
    const to = email();
    await shares.requestAck(token, to, T0);
    const failing = { sent: [] as unknown[], async send() { throw new Error("smtp down"); } };
    const r1 = await processOutbox(pool, failing, T0, 1000);
    expect(r1.failed).toBeGreaterThan(0);
    const ok = createMockEmailSender();
    expect((await processOutbox(pool, ok, T0, 1000)).sent).toBe(0); // belum jatuh tempo ulang
    await processOutbox(pool, ok, at(10), 1000);
    expect(ok.sent.some((m) => m.to === to)).toBe(true);
  });

  it("konfirmasi ganda email sama tidak membuat baris ganda; email tidak valid ditolak", async () => {
    const { token } = await sharedToken();
    const to = email();
    for (let i = 0; i < 2; i++) {
      const { code } = await requestAndRead(token, to, at(i * 20));
      expect(await shares.verifyAck(token, to, code!, at(i * 20 + 1))).toBe("VERIFIED");
    }
    expect((await pool.query("select count(*) from acknowledgements where email = $1", [to])).rows[0].count).toBe("1");
    await expect(shares.requestAck(token, "bukan-email", T0)).rejects.toThrow(/email/i);
    await expect(shares.requestAck(token, "a@b", T0)).rejects.toThrow(/email/i);
  });
});

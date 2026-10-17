import { beforeEach, describe, expect, it, vi } from "vitest";

// Audit C17: penyedia email nyata belum ada. Ketersediaan dibaca dari env; tanpa penyedia, tidak ada tantangan kode yang dibuat.
const share = { requestAck: vi.fn(), verifyAck: vi.fn() };
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT:${to}`); } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-real-ip": "1.2.3.4" }) }));
vi.mock("@/lib/vault/runtime", () => ({ shareService: () => share }));
// Task 24 (A07): pembatas konfirmasi baca kini berbasis DB (cakupan share_ack, kunci = clientIp()).
const ackAllow = vi.fn(async (_key: string) => true);
vi.mock("@/lib/security/limiters", () => ({ rateLimiter: (scope: string) => ({ allow: (k: string) => (scope === "share_ack" ? ackAllow(k) : Promise.resolve(true)) }) }));

import { ackEmailAvailable, emailProvider } from "@/lib/vault/email-config";
import { requestAckAction, verifyAckAction } from "@/app/(public)/s/[token]/actions";
import { ACK_ERROR_MESSAGES } from "@/lib/vault/messages";

const form = (v: Record<string, string>) => { const f = new FormData(); for (const [k, x] of Object.entries(v)) f.set(k, x); return f; };
const TOKEN = "t".repeat(43);

describe("emailProvider / ackEmailAvailable", () => {
  it("tanpa EMAIL_PROVIDER: tidak tersedia di semua lingkungan", () => {
    for (const NODE_ENV of ["production", "development", "test"]) expect(ackEmailAvailable({ NODE_ENV })).toBe(false);
  });
  it("mock hanya di luar produksi; nilai lain (belum ada adapter nyata) tidak tersedia", () => {
    expect(emailProvider({ NODE_ENV: "development", EMAIL_PROVIDER: "mock" })).toBe("mock");
    expect(ackEmailAvailable({ NODE_ENV: "production", EMAIL_PROVIDER: "mock" })).toBe(false);
    expect(ackEmailAvailable({ NODE_ENV: "production", EMAIL_PROVIDER: "resend" })).toBe(false);
    expect(ackEmailAvailable({ NODE_ENV: "development", EMAIL_PROVIDER: "sendgrid" })).toBe(false);
  });
});

describe("aksi konfirmasi baca", () => {
  const env = { ...process.env };
  beforeEach(() => { share.requestAck.mockReset(); share.verifyAck.mockReset(); process.env = { ...env }; });

  it("tanpa layanan email: permintaan kode tidak membuat tantangan dan memakai pesan tetap", async () => {
    delete process.env.EMAIL_PROVIDER;
    await expect(requestAckAction(form({ token: TOKEN, email: "pihak@example.test" }))).rejects.toThrow(`REDIRECT:/s/${TOKEN}?error=unavailable`);
    await expect(verifyAckAction(form({ token: TOKEN, email: "pihak@example.test", code: "123456" }))).rejects.toThrow(`REDIRECT:/s/${TOKEN}?error=unavailable`);
    expect(share.requestAck).not.toHaveBeenCalled();
    expect(share.verifyAck).not.toHaveBeenCalled();
    expect(ACK_ERROR_MESSAGES.unavailable).toBe("Konfirmasi baca lewat email belum tersedia karena layanan email belum aktif.");
  });

  it("dengan penyedia (mock, non-produksi): alur berjalan seperti biasa", async () => {
    process.env.EMAIL_PROVIDER = "mock";
    share.requestAck.mockResolvedValue("SENT");
    await expect(requestAckAction(form({ token: TOKEN, email: "Pihak@Example.test" }))).rejects.toThrow(`REDIRECT:/s/${TOKEN}?step=kode&e=pihak%40example.test`);
    expect(share.requestAck).toHaveBeenCalledTimes(1);
  });
});

describe("pembatas konfirmasi baca (Task 24, A07)", () => {
  const env = { ...process.env };
  beforeEach(() => { share.requestAck.mockReset(); ackAllow.mockClear(); process.env = { ...env, EMAIL_PROVIDER: "mock", NODE_ENV: "test" }; });
  it("kunci = IP dari clientIp() (x-real-ip), bukan x-forwarded-for mentah; ditolak → error=busy tanpa membuat tantangan", async () => {
    ackAllow.mockResolvedValueOnce(false);
    await expect(requestAckAction(form({ token: TOKEN, email: "pihak@example.test" }))).rejects.toThrow(`REDIRECT:/s/${TOKEN}?error=busy`);
    expect(ackAllow).toHaveBeenCalledWith("1.2.3.4");
    expect(share.requestAck).not.toHaveBeenCalled();
  });
});

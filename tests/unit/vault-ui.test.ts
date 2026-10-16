import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PublicShare } from "@/components/vault/public-share";
import { VaultPanel } from "@/components/vault/vault-panel";
import { renderDocument } from "@/lib/documents/render";
import { nda } from "@/lib/documents/templates/nda";
import type { Data } from "@/lib/documents/types";
import type { ShareView } from "@/lib/vault/share";

const noop = async () => {};
const data: Data = {
  disclosingParty: "Sinta Dewi", receivingParty: "Budi Santoso", signingDate: "2026-10-16", confidentialInfo: "Info",
  purpose: "Tujuan", termMonths: 24, disputeCity: "Jakarta",
};
const ok: ShareView = { status: "OK", versionNo: 2, sha256: "c".repeat(64), title: "Perjanjian Kerahasiaan (NDA)", doc: renderDocument(nda, data, "DRAFT"), hasNewer: true };

const panel = (over: Partial<Parameters<typeof VaultPanel>[0]> = {}) =>
  renderToStaticMarkup(VaultPanel({
    documentId: "d1", versionId: "v1", features: { share: true, reminders: true, evidence: true }, shares: [], acks: [],
    reminderOptions: [{ specId: "end", label: "Masa kerahasiaan berakhir", dueDate: "2028-10-16" }],
    actions: { createShare: noop as never, revokeShare: noop, setReminder: noop, cancelReminder: noop, buildPack: noop },
    ...over,
  }));

describe("VaultPanel", () => {
  it("menampilkan peringatan sebelum membuat link dan label bukan tanda tangan di konfirmasi", () => {
    const html = panel();
    expect(html).toContain("Siapa pun yang punya link dapat membaca dokumen ini");
    expect(html).toContain("bukan tanda tangan elektronik");
  });

  it("fitur yang tidak tersedia menampilkan 'Tersedia untuk Member' dan tidak menampilkan formulirnya", () => {
    const html = panel({ features: { share: false, reminders: false, evidence: false } });
    expect(html.match(/Tersedia untuk Member/g)?.length).toBe(3);
    expect(html).not.toContain("Siapa pun yang punya link");
    expect(html).not.toContain("Buat paket bukti");
  });

  it("pengingat menampilkan tenggat dalam bahasa Indonesia dan pilihan offset", () => {
    const html = panel();
    expect(html).toContain("16 Oktober 2028");
    for (const d of ["30", "7", "1"]) expect(html).toContain(`value="${d}"`);
  });

  it("daftar berbagi memuat status dan jumlah dibuka; konfirmasi baca memuat email", () => {
    const html = panel({
      shares: [{ id: "s1", expiresAt: "2026-10-20T00:00:00.000Z", revokedAt: null, createdAt: "2026-10-16T00:00:00.000Z", openedCount: 3 }],
      acks: [{ shareId: "s1", email: "pihak@example.test", verifiedAt: "2026-10-16T01:00:00.000Z" }],
    });
    expect(html).toContain("Dibuka 3 kali");
    expect(html).toContain("pihak@example.test");
  });

  it("semua tautan dan tombol punya tinggi minimal 48px; tanpa kata 'cap'", () => {
    const html = panel({ packId: "p1" });
    for (const tag of html.match(/<(a|button) [^>]*>/g) ?? []) expect(tag).toContain("min-h-12");
    expect(html).not.toMatch(/\bcap\b/i);
  });
});

describe("PublicShare", () => {
  const base = { token: "t".repeat(43), requestAction: noop, verifyAction: noop };

  it("menampilkan isi, kode versi, ajakan membuat dokumen, dan label bukan tanda tangan; tanpa data pemilik", () => {
    const html = renderToStaticMarkup(PublicShare({ ...base, view: ok }));
    expect(html).toContain("Sinta Dewi");
    expect(html).toContain("Versi 2");
    expect(html).toContain("cccccccccccc");
    expect(html).toContain("Ada versi yang lebih baru");
    expect(html).toContain("Versi baru belum diperiksa");
    expect(html).toContain("bukan tanda tangan elektronik");
    expect(html).toContain("Buat dokumen sendiri, gratis");
    expect(html.replace(/<input[^>]*>/g, "")).not.toContain("t".repeat(43));
  });

  it.each([
    ["NOT_FOUND", "Tautan tidak ditemukan"],
    ["EXPIRED", "Tautan sudah kedaluwarsa"],
    ["REVOKED", "Tautan sudah dicabut"],
  ] as const)("status %s hanya menampilkan pesan tetap tanpa isi", (status, msg) => {
    const html = renderToStaticMarkup(PublicShare({ ...base, view: { status } }));
    expect(html).toContain(msg);
    expect(html).not.toContain("Sinta Dewi");
    expect(html).not.toContain("<form");
  });

  it("langkah kode menampilkan kolom kode; hasil memakai pesan tetap dari kode, bukan teks dari URL", () => {
    const html = renderToStaticMarkup(PublicShare({ ...base, view: ok, step: "kode", email: "pihak@example.test", result: "LOCKED" }));
    expect(html).toContain('name="code"');
    expect(html).toContain("Terlalu banyak percobaan");
    const evil = renderToStaticMarkup(PublicShare({ ...base, view: ok, result: "Akun Anda diblokir, hubungi WA 0812" }));
    expect(evil).not.toContain("diblokir");
  });

  it("langkah kode menampilkan alamat tujuan, tombol kirim ulang kode, dan tautan ubah email", () => {
    const html = renderToStaticMarkup(PublicShare({ ...base, view: ok, step: "kode", email: "pihak@example.test" }));
    expect(html).toContain("Kode dikirim ke pihak@example.test");
    expect(html).toContain("Kirim ulang kode");
    expect(html).toContain("Ubah email");
    expect(html).toContain(`href="/s/${base.token}"`);
  });

  it("semua tautan dan tombol min-h-12", () => {
    const html = renderToStaticMarkup(PublicShare({ ...base, view: ok }));
    for (const tag of html.match(/<(a|button) [^>]*>/g) ?? []) expect(tag).toContain("min-h-12");
    const kode = renderToStaticMarkup(PublicShare({ ...base, view: ok, step: "kode", email: "a@b.co" }));
    for (const tag of kode.match(/<(a|button) [^>]*>/g) ?? []) expect(tag).toContain("min-h-12");
  });
});

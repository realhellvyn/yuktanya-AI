import { afterAll, describe, expect, it } from "vitest";
import { createPgDocumentsService, NotFoundError } from "@/lib/documents/service";
import type { Category, Data } from "@/lib/documents/types";
import { FeatureNotAvailableError } from "@/lib/vault/features";
import { createMockEmailSender, processOutbox } from "@/lib/vault/outbox";
import { createPgReminderService } from "@/lib/vault/reminders";
import { createUser, getPool } from "./helpers";

const pool = getPool();
afterAll(() => pool.end());
const NOW = new Date("2026-10-16T05:00:00Z");
const docs = createPgDocumentsService(pool, { ALLOW_UNAPPROVED_TEMPLATES: "true", NODE_ENV: "test" });
const reminders = createPgReminderService(pool, docs);
const key = () => `k-${Math.random().toString(36).slice(2)}-abcdef`;

const ndaData: Data = {
  disclosingParty: "Sinta Dewi", receivingParty: "Budi Santoso", signingDate: "2026-10-16", confidentialInfo: "ZZ-INFO-RAHASIA",
  purpose: "Evaluasi", termMonths: 24, disputeCity: "Jakarta",
};
const loanData: Data = {
  creditor: "Rina Contoh", debtor: "Agus Sintetis", signingDate: "2026-10-16", principalIdr: 5000000, dueDate: "2026-10-20",
  disputeCity: "Surabaya", repaymentNote: "ZZ-CATATAN-RAHASIA",
};

async function setup(category: Category, data: Data, isMember = true) {
  const u = await createUser(pool);
  if (isMember) await pool.query("insert into memberships(user_id, status, period_start, period_end) values ($1, 'ACTIVE', '2026-10-01', '2026-11-01')", [u]);
  const { documentId } = await docs.create(u, category, key());
  await docs.saveDraft(u, documentId, data, 0);
  const r = await docs.freeze(u, documentId, key(), NOW);
  if (!r.ok) throw new Error("freeze gagal");
  return { u, versionId: r.versionId };
}
const pending = async (reminderId: string) =>
  (await pool.query("select dedupe_key, available_at, status from outbox_events where dedupe_key like $1 order by available_at", [`reminder:${reminderId}:%`])).rows;

describe("pengingat tenggat", () => {
  it("options: NDA 24 bulan → 2028-10-16; Utang Piutang memakai dueDate", async () => {
    const n = await setup("NDA", ndaData);
    expect(await reminders.options(n.u, n.versionId)).toEqual([{ specId: "end", label: "Masa kerahasiaan berakhir", dueDate: "2028-10-16" }]);
    const l = await setup("UTANG_PIUTANG", loanData);
    expect(await reminders.options(l.u, l.versionId)).toEqual([{ specId: "due", label: "Pinjaman jatuh tempo", dueDate: "2026-10-20" }]);
  });

  it("offset 30/7/1 dijadwalkan pada hari yang benar pukul 08.00 WIB (01.00 UTC)", async () => {
    const n = await setup("NDA", ndaData);
    const r = await reminders.set(n.u, n.versionId, "end", [30, 7, 1], NOW);
    expect(r.scheduled).toBe(3);
    const rows = await pending(r.reminderId);
    expect(rows.map((x) => x.available_at.toISOString())).toEqual(["2028-09-16T01:00:00.000Z", "2028-10-09T01:00:00.000Z", "2028-10-15T01:00:00.000Z"]);
  });

  it("offset yang harinya sudah lewat dilewati; pengiriman memuat label dan tanggal tanpa isi dokumen", async () => {
    const l = await setup("UTANG_PIUTANG", loanData);
    const r = await reminders.set(l.u, l.versionId, "due", [7, 1, 0], NOW);
    expect(r.scheduled).toBe(2);
    const sender = createMockEmailSender();
    await processOutbox(pool, sender, new Date("2026-10-19T01:00:00Z"), 1000);
    await processOutbox(pool, sender, new Date("2026-10-20T01:00:00Z"), 1000);
    const mine = sender.sent.filter((m) => m.subject === "Pengingat: Pinjaman jatuh tempo");
    expect(mine.length).toBeGreaterThanOrEqual(2);
    expect(mine[0].text).toContain("20 Oktober 2026");
    for (const m of mine) {
      expect(m.text).not.toContain("ZZ-CATATAN-RAHASIA");
      expect(m.text).not.toContain("Rp5.000.000");
    }
  });

  it("set ulang membatalkan jadwal lama tanpa menggandakan", async () => {
    const n = await setup("NDA", ndaData);
    const a = await reminders.set(n.u, n.versionId, "end", [30, 7], NOW);
    const b = await reminders.set(n.u, n.versionId, "end", [1], NOW);
    expect((await pending(a.reminderId)).every((x) => x.status === "CANCELLED")).toBe(true);
    expect((await pending(b.reminderId)).map((x) => x.status)).toEqual(["PENDING"]);
    await reminders.cancel(n.u, n.versionId, "end", NOW);
    expect((await pending(b.reminderId)).map((x) => x.status)).toEqual(["CANCELLED"]);
  });

  it("tanpa fitur → FeatureNotAvailable; versi orang lain → NotFound; spec tak dikenal → NotFound", async () => {
    const free = await setup("NDA", ndaData, false);
    await expect(reminders.set(free.u, free.versionId, "end", [1], NOW)).rejects.toBeInstanceOf(FeatureNotAvailableError);
    const owner = await setup("NDA", ndaData);
    const other = await createUser(pool);
    await expect(reminders.options(other, owner.versionId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(reminders.set(other, owner.versionId, "end", [1], NOW)).rejects.toBeInstanceOf(NotFoundError);
    await expect(reminders.set(owner.u, owner.versionId, "tidak-ada", [1], NOW)).rejects.toBeInstanceOf(NotFoundError);
  });

  it.each([[[]], [[1, 2, 3, 4, 5, 6]], [[7, 7]], [[-1]], [[366]], [[1.5]]])("offset tidak valid %j ditolak", async (offsets) => {
    const n = await setup("NDA", ndaData);
    await expect(reminders.set(n.u, n.versionId, "end", offsets as number[], NOW)).rejects.toThrow(/offset/i);
  });
});

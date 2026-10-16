import { afterAll, describe, expect, it } from "vitest";
import { createPgCasesService } from "@/lib/cases/service";
import { loadOwnerCasePage, loadPartnerCasePage } from "@/lib/cases/pages";
import { asUser, createUser, getPool } from "./helpers";
import { NOW, at, key, makeKit } from "./phase3-helpers";

const pool = getPool();
afterAll(() => pool.end());
const kit = makeKit(pool);
const cases = createPgCasesService(pool);
const SUMMARY = "Perjanjian distribusi lintas provinsi dengan klausul eksklusivitas dan denda besar.";
const DAY = 24 * 60;

const q1 = (sql: string, params: unknown[] = []) => pool.query(sql, params).then((r) => r.rows[0]);
const submit = (owner: string, doc: string | null, opts: { consent?: boolean; summary?: string; k?: string } = {}) =>
  q1("select submit_special_case($1, $2, $3, $4, $5, $6) as id", [owner, doc, opts.summary ?? SUMMARY, opts.consent ?? true, opts.k ?? key(), NOW]).then((r) => r.id as string);
const triage = (actor: string, id: string, cleared = true, now = NOW) => pool.query("select triage_special_case($1, $2, $3, $4)", [actor, id, cleared, now]);
const quote = (actor: string, id: string, o: { amount?: number; scope?: string; expires?: Date; now?: Date } = {}) =>
  q1("select quote_special_case($1, $2, $3, $4, $5, $6) as rev", [actor, id, o.amount ?? 2_500_000, o.scope ?? "Telaah kontrak distribusi dan satu kali rapat daring.", o.expires ?? at(7 * DAY), o.now ?? NOW]).then((r) => r.rev as number);
const accept = (owner: string, id: string, rev: number, now = NOW) => pool.query("select accept_special_case_quote($1, $2, $3, $4)", [owner, id, rev, now]);
const decline = (owner: string, id: string, now = NOW) => pool.query("select decline_special_case_quote($1, $2, $3)", [owner, id, now]);
const close = (actor: string, id: string, reason = "Selesai", now = NOW) => pool.query("select close_special_case($1, $2, $3, $4)", [actor, id, reason, now]);
const statusOf = async (id: string) => (await q1("select status from special_cases where id = $1", [id])).status as string;

// Firma bawaan baru + pemilik dengan dokumen beku.
async function setup() {
  await pool.query("update firms set is_default = false");
  const f = await kit.firm({ isDefault: true });
  // Member: kuota dokumen harian cukup untuk dua dokumen beku.
  const owner = await kit.member();
  const v = await kit.frozen(owner);
  return { f, owner, v };
}

describe("special_cases: pengajuan pemilik", () => {
  it("tanpa persetujuan (consent) ditolak; ringkasan terlalu pendek ditolak; consent_at tercatat", async () => {
    const { owner, v } = await setup();
    await expect(submit(owner, v.documentId, { consent: false })).rejects.toThrow(/CONSENT_REQUIRED/);
    await expect(submit(owner, v.documentId, { summary: "pendek" })).rejects.toThrow(/SUMMARY_INVALID/);
    const id = await submit(owner, v.documentId);
    const row = await q1("select status, consent_at, firm_id, owner_id from special_cases where id = $1", [id]);
    expect(row.status).toBe("SUBMITTED");
    expect(row.consent_at.toISOString()).toBe(NOW.toISOString());
    expect(row.owner_id).toBe(owner);
    expect(row.firm_id).not.toBeNull();
  });

  it("idempoten per kunci; dokumen milik orang lain → NOT_FOUND; satu kasus terbuka per dokumen", async () => {
    const { owner, v } = await setup();
    const k = key();
    const a = await submit(owner, v.documentId, { k });
    expect(await submit(owner, v.documentId, { k })).toBe(a);
    await expect(submit(owner, v.documentId)).rejects.toThrow(/CASE_EXISTS/);
    const other = await createUser(pool);
    await expect(submit(other, v.documentId)).rejects.toThrow(/NOT_FOUND/);
    // Tanpa dokumen juga boleh (kasus di luar template).
    expect(await submit(other, null)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("klien (authenticated/anon) tidak bisa membaca tabel atau memanggil fungsi langsung", async () => {
    const { owner, v } = await setup();
    await submit(owner, v.documentId);
    await expect(asUser(pool, owner, (c) => c.query("select * from special_cases"))).rejects.toMatchObject({ code: "42501" });
    await expect(asUser(pool, owner, (c) => c.query("select submit_special_case($1, $2, $3, true, $4, now())", [owner, v.documentId, SUMMARY, key()]))).rejects.toMatchObject({ code: "42501" });
    await expect(asUser(pool, owner, (c) => c.query("select accept_special_case_quote($1, gen_random_uuid(), 1, now())", [owner]))).rejects.toMatchObject({ code: "42501" });
  });

  it("event special_case_requested ditulis sekali, tanpa ringkasan/teks hukum", async () => {
    const { owner, v } = await setup();
    const id = await submit(owner, v.documentId);
    const { rows } = await pool.query("select * from product_events where entity_id = $1 and event_name = 'special_case_requested'", [id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].actor_user_id).toBe(owner);
    expect(JSON.stringify(rows[0].metadata_safe)).not.toContain("distribusi");
  });
});

describe("special_cases: wewenang triase dan penawaran", () => {
  it("koordinator firma kasus boleh triase + menawar; reviewer, koordinator firma lain, admin, dan pemilik ditolak", async () => {
    const { f, owner, v } = await setup();
    const id = await submit(owner, v.documentId);
    const r = await f.addReviewer();
    const other = await kit.firm();
    await expect(triage(r.reviewer, id)).rejects.toThrow(/FORBIDDEN/);
    await expect(triage(other.coordinator, id)).rejects.toThrow(/FORBIDDEN/);
    await expect(triage(f.admin, id)).rejects.toThrow(/FORBIDDEN/);
    await expect(triage(owner, id)).rejects.toThrow(/FORBIDDEN/);
    await expect(triage(f.coordinator, id, false)).rejects.toThrow(/CONFLICT_CHECK_REQUIRED/);
    await triage(f.coordinator, id);
    expect(await statusOf(id)).toBe("TRIAGED");
    await expect(quote(f.admin, id)).rejects.toThrow(/FORBIDDEN/);
    await expect(quote(other.coordinator, id)).rejects.toThrow(/FORBIDDEN/);
    await expect(quote(r.reviewer, id)).rejects.toThrow(/FORBIDDEN/);
    expect(await quote(f.coordinator, id)).toBe(1);
    expect(await statusOf(id)).toBe("QUOTED");
  });

  it("koordinator tidak boleh menangani kasusnya sendiri", async () => {
    const { f } = await setup();
    const id = await submit(f.coordinator, null);
    await expect(triage(f.coordinator, id)).rejects.toThrow(/FORBIDDEN/);
  });

  it("validasi penawaran: nominal, ruang lingkup, masa berlaku", async () => {
    const { f, owner, v } = await setup();
    const id = await submit(owner, v.documentId);
    await triage(f.coordinator, id);
    await expect(quote(f.coordinator, id, { amount: 0 })).rejects.toThrow(/INVALID_AMOUNT/);
    await expect(quote(f.coordinator, id, { scope: " " })).rejects.toThrow(/INVALID_SCOPE/);
    await expect(quote(f.coordinator, id, { expires: at(-1) })).rejects.toThrow(/INVALID_EXPIRY/);
    await expect(quote(f.coordinator, id, { expires: at(200 * DAY) })).rejects.toThrow(/INVALID_EXPIRY/);
    expect(await statusOf(id)).toBe("TRIAGED");
  });

  it("daftar mitra: hanya kasus firmanya; admin melihat daftar tanpa ringkasan dan bisa merutekan, bukan menawar", async () => {
    const { f, owner, v } = await setup();
    const id = await submit(owner, v.documentId);
    const other = await kit.firm();
    expect((await cases.partnerList(f.coordinator)).map((c) => c.id)).toContain(id);
    expect((await cases.partnerList(other.coordinator)).map((c) => c.id)).not.toContain(id);
    expect(await cases.partnerGet(other.coordinator, id)).toBeNull();
    expect((await cases.partnerGet(f.coordinator, id))?.summary).toBe(SUMMARY);
    const adminRows = await cases.adminList(f.admin);
    const row = adminRows.find((c) => c.id === id)!;
    expect(row).toBeTruthy();
    expect(JSON.stringify(row)).not.toContain("distribusi");
    await expect(cases.adminList(owner)).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Rute ke firma lain: koordinator lama kehilangan akses, koordinator baru mendapatkannya.
    await pool.query("select admin_route_special_case($1, $2, $3, $4)", [f.admin, id, other.firmId, NOW]);
    expect(await cases.partnerGet(f.coordinator, id)).toBeNull();
    expect((await cases.partnerGet(other.coordinator, id))?.id).toBe(id);
    await expect(pool.query("select admin_route_special_case($1, $2, $3, $4)", [f.coordinator, id, f.firmId, NOW])).rejects.toThrow(/FORBIDDEN/);
  });
});

describe("special_cases: keputusan pemilik dan mesin status", () => {
  it("terima penawaran: ACCEPTED, tanpa order/pembayaran/verifikasi; event terkirim & diterima", async () => {
    const { f, owner, v } = await setup();
    const id = await submit(owner, v.documentId);
    await triage(f.coordinator, id);
    const rev = await quote(f.coordinator, id);
    const count = async () => q1(
      "select (select count(*) from orders where user_id = $1)::int as o, (select count(*) from payments p join orders o on o.id = p.order_id where o.user_id = $1)::int as p, (select count(*) from document_verifications where version_id = $2)::int as v",
      [owner, v.versionId]);
    const before = await count();
    const other = await createUser(pool);
    await expect(accept(other, id, rev)).rejects.toThrow(/NOT_FOUND/);
    await expect(accept(f.coordinator, id, rev)).rejects.toThrow(/NOT_FOUND/);
    await accept(owner, id, rev, at(60));
    expect(await statusOf(id)).toBe("ACCEPTED");
    expect(await count()).toEqual(before);
    const names = (await pool.query("select event_name, metadata_safe from product_events where entity_id = $1 order by occurred_at", [id])).rows;
    expect(names.map((r) => r.event_name).sort()).toEqual(["special_case_quote_accepted", "special_case_quote_sent", "special_case_requested"]);
    for (const r of names) expect(JSON.stringify(r.metadata_safe)).not.toMatch(/distribusi|rapat/);
  });

  it("penawaran kedaluwarsa tidak bisa diterima; penawaran ulang menaikkan revisi dan revisi lama ditolak", async () => {
    const { f, owner, v } = await setup();
    const id = await submit(owner, v.documentId);
    await triage(f.coordinator, id);
    const r1 = await quote(f.coordinator, id, { expires: at(DAY) });
    await expect(accept(owner, id, r1, at(DAY + 1))).rejects.toThrow(/QUOTE_EXPIRED/);
    expect(await statusOf(id)).toBe("QUOTED");
    const r2 = await quote(f.coordinator, id, { amount: 3_000_000, expires: at(5 * DAY, at(DAY + 1)), now: at(DAY + 1) });
    expect(r2).toBe(r1 + 1);
    await expect(accept(owner, id, r1, at(DAY + 2))).rejects.toThrow(/STALE_QUOTE/);
    await accept(owner, id, r2, at(DAY + 2));
    const page = await cases.getForOwner(owner, id);
    expect(page?.status).toBe("ACCEPTED");
    expect(page?.quote?.amountIdr).toBe(3_000_000);
  });

  it("transisi ilegal ditolak (INVALID_STATE)", async () => {
    const { f, owner, v } = await setup();
    const id = await submit(owner, v.documentId);
    await expect(quote(f.coordinator, id)).rejects.toThrow(/INVALID_STATE/);
    await expect(accept(owner, id, 0)).rejects.toThrow(/INVALID_STATE/);
    await expect(decline(owner, id)).rejects.toThrow(/INVALID_STATE/);
    await triage(f.coordinator, id);
    await expect(triage(f.coordinator, id)).rejects.toThrow(/INVALID_STATE/);
    const rev = await quote(f.coordinator, id);
    await decline(owner, id);
    expect(await statusOf(id)).toBe("DECLINED");
    await expect(accept(owner, id, rev)).rejects.toThrow(/INVALID_STATE/);
    await expect(quote(f.coordinator, id)).rejects.toThrow(/INVALID_STATE/);
    await close(f.coordinator, id);
    expect(await statusOf(id)).toBe("CLOSED");
    await expect(close(f.coordinator, id)).rejects.toThrow(/INVALID_STATE/);
    await expect(triage(f.coordinator, id)).rejects.toThrow(/INVALID_STATE/);

    // Pemilik boleh menarik sebelum menerima, tidak setelah ACCEPTED; admin tidak boleh menutup.
    const id2 = await submit(owner, null);
    await expect(close(f.admin, id2)).rejects.toThrow(/FORBIDDEN/);
    await close(owner, id2, "Tidak jadi");
    expect(await statusOf(id2)).toBe("CLOSED");
    const id3 = await submit(owner, null);
    await triage(f.coordinator, id3);
    await accept(owner, id3, await quote(f.coordinator, id3));
    await expect(close(owner, id3)).rejects.toThrow(/INVALID_STATE/);
    await expect(decline(owner, id3)).rejects.toThrow(/INVALID_STATE/);
    await close(f.coordinator, id3, "Perikatan selesai");
    expect(await statusOf(id3)).toBe("CLOSED");
  });

  it("isolasi lintas pengguna di layanan dan pemuat halaman", async () => {
    const { f, owner, v } = await setup();
    const id = await submit(owner, v.documentId);
    const other = await createUser(pool);
    expect(await cases.getForOwner(other, id)).toBeNull();
    expect((await cases.listForOwner(other)).map((c) => c.id)).not.toContain(id);
    expect((await cases.listForOwner(owner)).map((c) => c.id)).toContain(id);
    expect((await loadOwnerCasePage(cases, other, id)).kind).toBe("notFound");
    expect((await loadOwnerCasePage(cases, owner, "bukan-uuid")).kind).toBe("notFound");
    expect((await loadOwnerCasePage(cases, owner, id)).kind).toBe("ok");
    expect((await loadPartnerCasePage(cases, other, id)).kind).toBe("notFound");
    expect((await loadPartnerCasePage(cases, f.coordinator, id)).kind).toBe("ok");
    await expect(cases.accept(other, id, 1)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("special_cases: dokumen berkasus khusus tidak bisa membeli Review Standar", () => {
  it("order dan pratinjau harga STANDARD_REVIEW ditolak selama kasus terbuka; boleh lagi setelah ditolak/ditutup", async () => {
    const { f, owner, v } = await setup();
    const id = await submit(owner, v.documentId);
    expect(await cases.openForDocument(owner, v.documentId)).toBe(id);
    await expect(kit.order(owner, "STANDARD_REVIEW", v.versionId)).rejects.toThrow(/SPECIAL_CASE_OPEN/);
    await expect(pool.query("select * from preview_price($1, 'STANDARD_REVIEW', $2, $3)", [owner, v.versionId, NOW])).rejects.toThrow(/SPECIAL_CASE_OPEN/);
    expect((await q1("select count(*)::int as n from orders where user_id = $1 and kind = 'STANDARD_REVIEW'", [owner])).n).toBe(0);
    await triage(f.coordinator, id);
    await quote(f.coordinator, id);
    await decline(owner, id);
    expect(await cases.openForDocument(owner, v.documentId)).toBeNull();
    const o = await kit.order(owner, "STANDARD_REVIEW", v.versionId);
    expect(o.status).toBe("PENDING_PAYMENT");
  });

  it("kasus untuk dokumen lain tidak memblokir dokumen ini", async () => {
    const { owner, v } = await setup();
    const v2 = await kit.frozen(owner);
    await submit(owner, v2.documentId);
    expect((await kit.order(owner, "STANDARD_REVIEW", v.versionId)).status).toBe("PENDING_PAYMENT");
  });
});

describe("special_cases: pembayaran order Review Standar yang sudah ada", () => {
  it("order menunggu bayar lalu kasus dibuka → mulai bayar ditolak SPECIAL_CASE_OPEN; setelah kasus ditolak → boleh", async () => {
    const { f, owner, v } = await setup();
    const o = await kit.order(owner, "STANDARD_REVIEW", v.versionId);
    const id = await submit(owner, v.documentId);
    await expect(kit.pay(owner, o.order_id)).rejects.toThrow(/SPECIAL_CASE_OPEN/);
    expect((await q1("select count(*)::int as n from payments where order_id = $1", [o.order_id])).n).toBe(0);
    await triage(f.coordinator, id);
    await quote(f.coordinator, id);
    await decline(owner, id);
    const p = await kit.pay(owner, o.order_id);
    expect(await kit.settle("mock", p.ref, o.amount_idr)).toBe("SETTLED");
  });

  it("setelah kasus ditutup/ditarik → mulai bayar boleh", async () => {
    const { owner, v } = await setup();
    const o = await kit.order(owner, "STANDARD_REVIEW", v.versionId);
    const id = await submit(owner, v.documentId);
    await expect(kit.pay(owner, o.order_id)).rejects.toThrow(/SPECIAL_CASE_OPEN/);
    await close(owner, id, "Tidak jadi");
    expect((await kit.pay(owner, o.order_id)).paymentId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("pembayaran yang sudah dibuat sebelum kasus tetap bisa diselesaikan (uang sudah diterima)", async () => {
    const { owner, v } = await setup();
    const o = await kit.order(owner, "STANDARD_REVIEW", v.versionId);
    const p = await kit.pay(owner, o.order_id);
    await submit(owner, v.documentId);
    expect(await kit.settle("mock", p.ref, o.amount_idr)).toBe("SETTLED");
    expect((await q1("select status from orders where id = $1", [o.order_id])).status).toBe("PAID");
  });

  it("layanan billing memetakan kode ke BillingError SPECIAL_CASE_OPEN (bukan 500)", async () => {
    const { createPgBillingService } = await import("@/lib/billing/service");
    const { owner, v } = await setup();
    const o = await kit.order(owner, "STANDARD_REVIEW", v.versionId);
    await submit(owner, v.documentId);
    const billing = createPgBillingService(pool, [{ name: "mock", createCharge: async () => ({ providerRef: `ref-${key()}`, instructions: "" }) } as never]);
    await expect(billing.startPayment(owner, o.order_id, "mock")).rejects.toMatchObject({ code: "SPECIAL_CASE_OPEN" });
  });
});

// Event produk v8: ditulis server/DB setelah transisi tepercaya, idempoten (kunci dedupe), payload hanya kunci daftar-izin,
// best-effort (kegagalan menulis event tidak pernah menggagalkan transaksi bisnis), dan cocok dengan tabel sumber.
import { afterAll, describe, expect, it } from "vitest";
import { DOC_EVENT_NAMES, EVENT_CATALOGUE, RECORDED_EVENT_NAMES, SAFE_METADATA_KEYS } from "@/lib/analytics/catalogue";
import { trackEvent } from "@/lib/analytics/events";
import { asUser, createUser, getPool } from "./helpers";
import { key, makeKit, NOW } from "./phase3-helpers";

const pool = getPool();
afterAll(() => pool.end());
const kit = makeKit(pool);
const ITEMS = ["M1", "M2", "M3", "M4", "M5", "M6", "M7"];
const PII = /ZZ-RAHASIA|Sinta Dewi|Budi Santoso|Jangka waktu|Tidak jelas|Perjelas|Risiko sengketa|@example\.test|Pemeriksaan identitas|Bukti M|Penalaran M|distribusi/;

type Ev = { event_name: string; entity_type: string | null; entity_id: string | null; actor_user_id: string | null; occurred_at: Date; metadata_safe: Record<string, unknown> };
const eventsFor = async (ids: string[]): Promise<Ev[]> =>
  (await pool.query("select event_name, entity_type, entity_id, actor_user_id, occurred_at, metadata_safe from product_events where entity_id = any($1::text[])", [ids])).rows;
const names = (evs: Ev[], id: string) => evs.filter((e) => e.entity_id === id).map((e) => e.event_name).sort();

// Standar selesai WITH_NOTES → deep dibayar, ditugaskan, diputuskan APPROVE (Enhanced) → induk dicabut.
async function fullFlow() {
  const admin = await kit.admin();
  await pool.query("select admin_approve_rubric($1, 'v8-proposed', 'Persetujuan mitra #1', $2)", [admin, NOW]);
  const c = await kit.completedStandard({ severity: "MATERIAL" });
  const b = await kit.buy(c.owner, "DEEP_REVIEW", c.req);
  const deep = (await pool.query("select * from deep_requests where order_id = $1", [b.order_id])).rows[0];
  await pool.query("select assign_deep($1, $2, $3, $4)", [c.f.coordinator, deep.id, c.r.reviewer, NOW]);
  const rv = c.r.reviewer;
  let rev = (await pool.query("select * from start_deep($1, $2, $3)", [rv, deep.id, NOW])).rows[0].revision as number;
  const bump = async (sql: string, args: unknown[]) => { rev = (await pool.query(sql, [rv, deep.id, rev, ...args, NOW])).rows[0].r as number; };
  await bump("select save_deep_draft($1, $2, $3, $4, $5, $6) as r", ["Pemeriksaan identitas dan kewenangan para pihak", "Ringkasan pemeriksaan tambahan"]);
  await bump("select set_disposition($1, $2, $3, 1, $4, $5, $6) as r", ["RESOLVED", "Klausul diperbaiki di versi baru"]);
  for (const item of ITEMS) await bump("select set_checklist($1, $2, $3, $4, $5, $6, $7, $8) as r", [item, "PASS", "Penalaran " + item, "Bukti " + item]);
  const d = (await pool.query("select * from decide_deep($1, $2, $3, 'APPROVE', null, true, $4)", [rv, deep.id, rev, NOW])).rows[0];
  const std = (await pool.query("select o.id as order_id, p.id as payment_id, a.id as assignment_id from review_requests r join orders o on o.id = r.order_id join payments p on p.order_id = o.id join review_assignments a on a.request_id = r.id where r.id = $1", [c.req])).rows[0];
  const deepPay = (await pool.query("select id from payments where order_id = $1", [b.order_id])).rows[0].id as string;
  const deepAssign = (await pool.query("select id from deep_assignments where deep_id = $1", [deep.id])).rows[0].id as string;
  const report = (await pool.query("select id from deep_reports where deep_id = $1", [deep.id])).rows[0].id as string;
  const notes = (await pool.query("select n.id from legal_notes n join review_reports rp on rp.id = n.report_id where rp.request_id = $1", [c.req])).rows.map((r) => r.id as string);
  await pool.query("select revoke_verification($1, $2, 'ERROR', 'catatan privat sintetis', $3)", [c.f.admin, c.verificationId, NOW]);
  return { c, b, deep, d, std, deepPay, deepAssign, report, notes, admin };
}

describe("katalog di DB = katalog di kode", () => {
  it("nama event dan kunci metadata yang diizinkan identik di SQL dan TypeScript", async () => {
    const sqlNames = (await pool.query("select unnest(analytics_event_names()) as n")).rows.map((r) => r.n).sort();
    expect(sqlNames).toEqual([...RECORDED_EVENT_NAMES].sort());
    const sqlKeys = (await pool.query("select unnest(analytics_safe_keys()) as k")).rows.map((r) => r.k).sort();
    expect(sqlKeys).toEqual([...SAFE_METADATA_KEYS].sort());
    expect(DOC_EVENT_NAMES).toHaveLength(28);
    for (const e of EVENT_CATALOGUE) expect(sqlNames).toContain(e.recordedAs);
  });

  it("penyaring metadata membuang judul/temuan/nama/objek; nama di luar katalog ditolak; klien tidak dapat menulis", async () => {
    const out = (await pool.query("select analytics_safe_metadata($1) as m", [JSON.stringify({
      title: "Jangka waktu", finding: "Tidak jelas", name: "Sinta Dewi", category: "NDA", amount_idr: 50000, nested: { a: 1 }, outcome: "Sinta Dewi", actionable: true,
    })])).rows[0].m;
    expect(out).toEqual({ category: "NDA", amount_idr: 50000, actionable: true });
    const u = await createUser(pool);
    const bad = (await pool.query("select record_product_event($1, 'event_karangan', 'x', 'x', $2, now(), '{}') as ok", [u, key()])).rows[0].ok;
    expect(bad).toBe(false);
    expect((await pool.query("select count(*)::int as n from product_events where event_name = 'event_karangan'")).rows[0].n).toBe(0);
    await expect(asUser(pool, u, (c) => c.query("select record_product_event($1, 'deep_offer_shown', 'x', 'x', 'k', now(), '{}')", [u]))).rejects.toThrow(/permission denied/);
    await expect(asUser(pool, u, (c) => c.query("insert into product_events (event_name, dedupe_key) values ('review_payment_verified', 'palsu')"))).rejects.toThrow(/permission denied/);
  });
});

describe("hook alur bisnis → product_events", () => {
  it("pendaftaran, dokumen, versi beku, review diminta/dibayar/ditugaskan/selesai, catatan terbit, verifikasi, deep, pencabutan: tepat sekali per entitas", async () => {
    const f = await fullFlow();
    const { c } = f;
    const ids = [c.owner, c.v.documentId, c.v.versionId, f.std.order_id, f.std.payment_id, f.std.assignment_id, c.req, c.verificationId, ...f.notes,
      f.b.order_id, f.deepPay, f.deepAssign, f.deep.id, f.report, f.d.verification_id];
    const evs = await eventsFor(ids);
    expect(names(evs, c.owner)).toEqual(["signup_completed"]);
    expect(names(evs, c.v.documentId)).toEqual(["document_started"]);
    expect(names(evs, c.v.versionId)).toEqual(["draft_completed"]);
    expect(names(evs, f.std.order_id)).toEqual(["review_requested"]);
    expect(names(evs, f.std.payment_id)).toEqual(["review_payment_verified"]);
    expect(names(evs, f.std.assignment_id)).toEqual(["review_assigned"]);
    expect(names(evs, c.req)).toEqual(["deep_eligible", "review_completed", "standard_completed"]);
    expect(names(evs, f.notes[0])).toEqual(["legal_note_published"]);
    expect(names(evs, c.verificationId)).toEqual(["legal_verification_issued", "verification_revoked"]);
    expect(names(evs, f.b.order_id)).toEqual(["deep_quote_accepted"]);
    expect(names(evs, f.deepPay)).toEqual(["deep_payment_verified"]);
    expect(names(evs, f.deepAssign)).toEqual(["deep_assigned"]);
    expect(names(evs, f.deep.id)).toEqual(["deep_completed"]);
    expect(names(evs, f.report)).toEqual(["deep_approval_recorded"]);
    expect(names(evs, f.d.verification_id)).toEqual(["legal_enhanced_verification_issued"]);
    const byName = Object.fromEntries(evs.map((e) => [e.event_name, e]));
    expect(byName.review_payment_verified.metadata_safe).toMatchObject({ kind: "STANDARD_REVIEW", amount_idr: 50000 });
    expect(byName.deep_completed.metadata_safe).toMatchObject({ outcome: "ENHANCED_APPROVED" });
    expect(byName.document_started.metadata_safe).toMatchObject({ category: "NDA" });
    expect(byName.legal_note_published.metadata_safe).toMatchObject({ severity: "MATERIAL", actionable: true });
    expect(byName.verification_revoked.metadata_safe).toMatchObject({ kind: "LEGAL", reason_code: "ERROR" });
    // waktu kejadian = waktu transisi sumber, bukan waktu tulis
    expect(byName.review_payment_verified.occurred_at.toISOString()).toBe(NOW.toISOString());
    expect(byName.review_completed.occurred_at.toISOString()).toBe(NOW.toISOString());

    // Payload: hanya kunci daftar-izin, nilai skalar, tanpa isi dokumen, nama pihak, teks catatan, alasan privat, atau email.
    for (const e of evs) {
      for (const [k, v] of Object.entries(e.metadata_safe)) {
        expect(SAFE_METADATA_KEYS, `${e.event_name}.${k}`).toContain(k);
        expect(["string", "number", "boolean"]).toContain(typeof v);
      }
    }
    expect(JSON.stringify(evs)).not.toMatch(PII);
    expect(JSON.stringify(evs)).not.toContain("catatan privat");
  });

  it("idempoten: transisi ulang (panggilan ulang decide_deep, settle ulang) tidak menggandakan event", async () => {
    const c = await kit.completedStandard({ noNotes: true });
    const before = (await eventsFor([c.req])).length;
    await pool.query("update review_requests set status = status where id = $1", [c.req]);
    const p = (await pool.query("select p.provider_ref from payments p join review_requests r on r.order_id = p.order_id where r.id = $1", [c.req])).rows[0].provider_ref;
    await kit.settle("mock", p, 50000);
    expect((await eventsFor([c.req])).length).toBe(before);
    // WITHIN_SCOPE tanpa catatan: bukan deep_eligible
    expect(names(await eventsFor([c.req]), c.req)).toEqual(["review_completed", "standard_completed"]);
  });

  it("membership aktif, pengembalian dana, kasus khusus (nama Task 5), AI review", async () => {
    const m = await kit.member("2026-10-01", "2026-11-01");
    const mem = (await pool.query("select id from memberships where user_id = $1", [m])).rows[0].id as string;
    expect(names(await eventsFor([mem]), mem)).toEqual(["membership_activated"]);
    const c = await kit.completedStandard();
    const b = await kit.buy(c.owner, "DEEP_REVIEW", c.req);
    await pool.query("select revoke_verification($1, $2, 'ERROR', null, $3)", [c.f.admin, c.verificationId, NOW]);
    await pool.query("select admin_resolve_reconciliation($1, $2, 'REFUND_RECORDED', 'dikembalikan via bank', $3)", [c.f.admin, b.order_id, NOW]);
    const pay = (await pool.query("select id from payments where order_id = $1", [b.order_id])).rows[0].id as string;
    expect(names(await eventsFor([pay]), pay)).toEqual(["deep_payment_verified", "payment_refunded"]);
    const owner = await createUser(pool);
    const v = await kit.frozen(owner);
    const caseId = (await pool.query("select submit_special_case($1, $2, $3, true, $4, $5) as id", [owner, v.documentId, "Perjanjian distribusi lintas provinsi (sintetis) panjang.", key(), NOW])).rows[0].id;
    const ce = await eventsFor([caseId]);
    expect(names(ce, caseId)).toEqual(["special_case_requested"]);
    expect(JSON.stringify(ce)).not.toMatch(PII);
  });
});

describe("best-effort: kegagalan menulis event tidak menggagalkan transaksi bisnis", () => {
  it("dengan product_events rusak, alur review standar, kasus khusus, dan keanggotaan tetap selesai; event yang hilang tidak ditulis", async () => {
    await pool.query("create or replace function test_break_events() returns trigger language plpgsql as $$ begin raise exception 'event store mati'; end $$");
    await pool.query("create trigger test_break_events before insert on product_events for each row execute function test_break_events()");
    try {
      const c = await kit.completedStandard();
      expect((await pool.query("select status from review_requests where id = $1", [c.req])).rows[0].status).toBe("COMPLETED");
      expect((await pool.query("select status from document_verifications where id = $1", [c.verificationId])).rows[0].status).toBe("ACTIVE");
      const caseId = (await pool.query("select submit_special_case($1, null, $2, true, $3, $4) as id", [c.owner, "Permintaan penilaian khusus sintetis yang cukup panjang.", key(), NOW])).rows[0].id;
      expect(caseId).toBeTruthy();
      const m = await kit.member();
      expect(m).toBeTruthy();
      expect(await eventsFor([c.req, c.v.documentId, caseId])).toEqual([]);
      expect(await trackEvent(pool, { name: "deep_offer_shown", actorUserId: c.owner, entityType: "review_request", entityId: c.req, dedupeKey: `x:${c.req}` })).toBe(false);
    } finally {
      await pool.query("drop trigger test_break_events on product_events");
      await pool.query("drop function test_break_events()");
    }
  });
});

describe("rekonsiliasi event ↔ tabel sumber", () => {
  it("jumlah event per jenis sama dengan baris sumber untuk entitas yang dibuat (dokumen, versi, order, pembayaran, selesai, verifikasi)", async () => {
    const owners = [await createUser(pool), await createUser(pool), await kit.member("2026-10-01", "2027-12-01")];
    for (const u of owners) await kit.frozen(u);
    const c1 = await kit.completedStandard();
    const c2 = await kit.completedStandard({ noNotes: true });
    const users = [...owners, c1.owner, c2.owner];
    const src = async (sql: string) => Number((await pool.query(sql, [users])).rows[0].n);
    const ev = async (name: string, sql: string) => Number((await pool.query(`select count(*) as n from product_events e where e.event_name = '${name}' and e.entity_id in (${sql})`, [users])).rows[0].n);
    const pairs: [string, string][] = [
      ["document_started", "select d.id::text from documents d where d.owner_id = any($1)"],
      ["draft_completed", "select v.id::text from document_versions v join documents d on d.id = v.document_id where d.owner_id = any($1)"],
      ["review_requested", "select o.id::text from orders o where o.kind = 'STANDARD_REVIEW' and o.user_id = any($1)"],
      ["review_payment_verified", "select p.id::text from payments p join orders o on o.id = p.order_id where o.kind = 'STANDARD_REVIEW' and p.verified_at is not null and o.user_id = any($1)"],
      ["review_completed", "select r.id::text from review_requests r where r.status = 'COMPLETED' and r.owner_id = any($1)"],
      ["legal_verification_issued", "select dv.id::text from document_verifications dv join review_requests r on r.id = dv.request_id where dv.kind = 'LEGAL' and r.owner_id = any($1)"],
    ];
    for (const [name, sql] of pairs) {
      const s = await src(`select count(*) as n from (${sql}) x`);
      expect(s, name).toBeGreaterThan(0);
      expect(await ev(name, sql), name).toBe(s);
    }
    // Jumlah uang di event = jumlah pembayaran terverifikasi di sumber
    const amt = (await pool.query(`select coalesce(sum(p.amount_idr), 0)::int as s, coalesce(sum((e.metadata_safe->>'amount_idr')::int), 0)::int as e
      from payments p join orders o on o.id = p.order_id left join product_events e on e.entity_id = p.id::text and e.event_name = 'review_payment_verified'
      where o.user_id = any($1) and o.kind = 'STANDARD_REVIEW' and p.verified_at is not null`, [users])).rows[0];
    expect(amt.e).toBe(amt.s);
  });
});

describe("admin tidak dapat membaca isi privat (tingkat DB)", () => {
  it("peran platform_admin lewat klien: isi dokumen, draf, catatan hukum, pesan chat, ringkasan kasus, laporan AI, event → ditolak atau kosong", async () => {
    const c = await kit.completedStandard();
    const admin = await kit.admin();
    await pool.query("insert into document_messages (document_id, role, content, idempotency_key) values ($1, 'user', 'ZZ-RAHASIA pesan', $2)", [c.v.documentId, key()]);
    await pool.query("select submit_special_case($1, null, $2, true, $3, $4)", [c.owner, "Sinta Dewi ringkasan kasus sintetis yang rahasia.", key(), NOW]);
    const probes = [
      "select canonical_text as x from document_versions",
      "select structured_data::text as x from document_drafts",
      "select finding as x from legal_notes",
      "select summary as x from review_reports",
      "select content as x from document_messages",
      "select summary as x from special_cases",
      "select report_json::text as x from ai_review_reports",
      "select original_filename as x from document_uploads",
      "select metadata_safe::text as x from product_events",
      "select private_reason as x from verification_revocations",
    ];
    for (const sql of probes) {
      const res = await asUser(pool, admin, (cl) => cl.query(sql)).then((r) => r.rows, (e: { code?: string }) => {
        expect(e.code, sql).toBe("42501");
        return [];
      });
      expect(res, sql).toEqual([]);
    }
    // Fungsi agregat admin tidak mengembalikan isi
    const a = (await pool.query("select admin_analytics($1, $2, $3, null, null) as a", [admin, new Date(NOW.getTime() - 86_400_000 * 2), new Date(Date.now() + 86_400_000)])).rows[0].a;
    expect(JSON.stringify(a)).not.toMatch(PII);
  });
});

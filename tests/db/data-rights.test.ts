import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createFsBlobStore } from "@/lib/documents/blob";
import { eraseAccount } from "@/lib/retention/erasure";
import { retentionJobHandler } from "@/lib/retention/retention";
import { asUser, createUser, getPool } from "./helpers";
import { key, makeKit, ndaData, NOW } from "./phase3-helpers";

// Hak data (Task 8): retensi terjadwal, ekspor data milik sendiri, penghapusan akun dengan anonimisasi catatan yang wajib disimpan.
const pool = getPool();
afterAll(() => pool.end());
const kit = makeKit(pool);
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const count = async (sql: string, args: unknown[]) => (await pool.query(sql, args)).rows[0].n as number;

async function share(u: string, versionId: string) {
  const token = hash(`tok-${Math.random()}`);
  const id = (await pool.query("select create_share($1, $2, $3, $4, $5) as id", [u, versionId, token, new Date(NOW.getTime() + 7 * DAY), NOW])).rows[0].id as string;
  return { id, token };
}
async function challenge(shareId: string, email: string, createdAt: Date) {
  return (await pool.query(
    "insert into ack_challenges (share_id, email, code_hash, expires_at, created_at) values ($1, $2, $3, $4, $5) returning id",
    [shareId, email, hash(String(Math.random())), new Date(createdAt.getTime() + 10 * 60_000), createdAt],
  )).rows[0].id as string;
}
async function message(documentId: string, role: "user" | "assistant", content: string) {
  await pool.query("insert into document_messages (document_id, role, content, answered) values ($1, $2, $3, true)", [documentId, role, content]);
}
async function closedCase(owner: string, documentId: string | null, summary: string, triagedBy: string) {
  return (await pool.query(
    `insert into special_cases (owner_id, document_id, summary, status, consent_at, idempotency_key, triaged_by, triaged_at, closed_by, closed_at, close_reason)
     values ($1, $2, $3, 'CLOSED', $4, $5, $6, $4, $6, $4, 'Di luar keahlian firma') returning id`,
    [owner, documentId, summary, NOW, key(), triagedBy],
  )).rows[0].id as string;
}
const exportOf = async (u: string) => (await pool.query("select export_account_data($1, $2) as j", [u, NOW])).rows[0].j as Record<string, unknown>;
const erase = async (u: string, now: Date = NOW) => (await pool.query("select erase_account($1, $2) as r", [u, now])).rows[0].r as {
  status: string; reasons?: string[]; storage_paths?: string[]; documents_deleted?: number; documents_retained?: number;
};

describe("run_retention", () => {
  it("menghapus ai_attempts > 30 hari dan tantangan konfirmasi baca > 7 hari setelah kedaluwarsa; baris baru tetap", async () => {
    const u = await kit.member("2026-10-01", "2027-12-01");
    const v = await kit.frozen(u);
    const s = await share(u, v.versionId);
    for (const d of [31, 45]) await pool.query("insert into ai_attempts (user_id, scope, occurred_at) values ($1, 'chat', $2)", [u, ago(d)]);
    await pool.query("insert into ai_attempts (user_id, scope, occurred_at) values ($1, 'chat', $2)", [u, ago(29)]);
    const oldC = await challenge(s.id, "pihak@example.test", ago(9));
    const newC = await challenge(s.id, "pihak@example.test", ago(1));
    const r = (await pool.query("select run_retention($1, 5000) as r", [NOW])).rows[0].r;
    expect(r.ai_attempts).toBeGreaterThanOrEqual(2);
    expect(r.more).toBe(false);
    expect(await count("select count(*)::int as n from ai_attempts where user_id = $1", [u])).toBe(1);
    expect(await count("select count(*)::int as n from ack_challenges where id = $1", [oldC])).toBe(0);
    expect(await count("select count(*)::int as n from ack_challenges where id = $1", [newC])).toBe(1);
    // Idempoten: putaran kedua tidak menghapus apa pun lagi dari pengguna ini.
    await pool.query("select run_retention($1, 5000)", [NOW]);
    expect(await count("select count(*)::int as n from ai_attempts where user_id = $1", [u])).toBe(1);
  });

  it("membersihkan baris auth_attempts yang jendelanya lebih tua dari 2 hari; baris baru tetap (Task 13 M4)", async () => {
    const h = () => hash(`auth-${Math.random()}`);
    const [old1, old2, fresh] = [h(), h(), h()];
    for (const [k, when] of [[old1, ago(3)], [old2, ago(10)], [fresh, ago(1)]] as const) {
      await pool.query("insert into auth_attempts (scope, key_hash, window_start, hits) values ('login:ip', $1, $2, 4)", [k, when]);
    }
    const r = (await pool.query("select run_retention($1, 5000) as r", [NOW])).rows[0].r;
    expect(r.auth_attempts).toBeGreaterThanOrEqual(2);
    expect(r.more).toBe(false);
    expect(await count("select count(*)::int as n from auth_attempts where key_hash = any($1)", [[old1, old2]])).toBe(0);
    expect(await count("select count(*)::int as n from auth_attempts where key_hash = $1", [fresh])).toBe(1);
  });

  it("dibatasi per batch: sisa ditandai more=true dan habis pada putaran berikutnya", async () => {
    await pool.query("select run_retention($1, 100000)", [NOW]);
    const u = await createUser(pool);
    for (let i = 0; i < 5; i++) await pool.query("insert into ai_attempts (user_id, scope, occurred_at) values ($1, 'assist', $2)", [u, ago(40 + i)]);
    const r1 = (await pool.query("select run_retention($1, 2) as r", [NOW])).rows[0].r;
    expect(r1).toMatchObject({ ai_attempts: 2, more: true });
    await pool.query("select run_retention($1, 2)", [NOW]);
    const r3 = (await pool.query("select run_retention($1, 2) as r", [NOW])).rows[0].r;
    expect(r3).toMatchObject({ ai_attempts: 1, more: false });
    expect(await count("select count(*)::int as n from ai_attempts where user_id = $1", [u])).toBe(0);
  });

  it("hanya service_role: pengguna biasa tidak dapat memanggil fungsi retensi, ekspor, atau penghapusan", async () => {
    const u = await createUser(pool);
    await expect(asUser(pool, u, (c) => c.query("select run_retention(now(), 10)"))).rejects.toThrow(/permission denied/);
    await expect(asUser(pool, u, (c) => c.query("select export_account_data($1, now())", [u]))).rejects.toThrow(/permission denied/);
    await expect(asUser(pool, u, (c) => c.query("select erase_account($1, now())", [u]))).rejects.toThrow(/permission denied/);
  });
});

describe("export_account_data", () => {
  it("hanya data milik sendiri; tanpa catatan draf, identitas reviewer/koordinator, atau field triase internal", async () => {
    const std = await kit.completedStandard({ member: true });
    const a = std.owner;
    const b = await createUser(pool);
    await pool.query("update profiles set display_name = 'Sinta Ekspor' where id = $1", [a]);
    const docA = await kit.frozen(a);
    await message(docA.documentId, "user", "Pesan milik A tentang kontrak");
    await message(docA.documentId, "assistant", "Balasan untuk A");
    await pool.query(
      `insert into document_uploads (version_id, document_id, file_kind, original_filename, byte_size, original_sha256, storage_path, char_count, risk_level)
       values ($1, $2, 'TXT', 'kontrak-a.txt', 10, $3, $4, 10, 'NORMAL')`,
      [docA.versionId, docA.documentId, hash("a"), `uploads/${docA.documentId}/orig`],
    );
    await closedCase(a, docA.documentId, "Ringkasan kasus milik A yang cukup panjang", std.f.coordinator);
    const docB = await kit.frozen(b, { ...ndaData, confidentialInfo: "RAHASIA-B-123" });
    await message(docB.documentId, "user", "PESAN-B-RAHASIA");
    await closedCase(b, docB.documentId, "Ringkasan kasus milik B RAHASIA-B-456", std.f.coordinator);
    await kit.order(b, "MEMBERSHIP_MONTHLY", null);

    const j = await exportOf(a);
    const s = JSON.stringify(j);
    expect(j).toMatchObject({ format: "yuktanya-export-v1", user_id: a });
    expect((j.profile as { display_name: string }).display_name).toBe("Sinta Ekspor");
    const docs = j.documents as { id: string; title: string; versions: { canonical_text: string; sha256: string }[]; messages: { content: string }[]; upload: unknown }[];
    expect(docs.map((d) => d.id).sort()).toEqual([std.v.documentId, docA.documentId].sort());
    const da = docs.find((d) => d.id === docA.documentId)!;
    expect(da.versions[0].canonical_text.length).toBeGreaterThan(50);
    expect(da.messages.map((m) => m.content)).toEqual(["Pesan milik A tentang kontrak", "Balasan untuk A"]);
    expect(da.upload).toMatchObject({ original_filename: "kontrak-a.txt" });
    expect((j.orders as unknown[]).length).toBeGreaterThanOrEqual(1);
    expect((j.special_cases as { summary: string }[]).map((c) => c.summary)).toEqual(["Ringkasan kasus milik A yang cukup panjang"]);
    const reviews = j.reviews as { status: string; outcome: string; report: { summary: string; notes: { title: string }[] } | null }[];
    expect(reviews[0]).toMatchObject({ status: "COMPLETED", outcome: "WITH_NOTES" });
    expect(reviews[0].report!.notes.map((n) => n.title)).toEqual(["Jangka waktu"]);

    // Isolasi: tidak ada jejak B, reviewer, koordinator, firma, atau kolom internal.
    for (const forbidden of [b, docB.documentId, "RAHASIA-B", "PESAN-B-RAHASIA", std.r.reviewer, std.f.coordinator, std.f.firmId, std.f.admin]) {
      expect(s).not.toContain(forbidden);
    }
    for (const field of ["triaged_by", "quoted_by", "closed_by", "author_id", "reviewer_id", "assigned_by", "firm_id", "storage_path", "private_reason", "idempotency_key", "token_hash"]) {
      expect(s).not.toContain(`"${field}"`);
    }
    // Ukuran wajar untuk akun biasa.
    expect(s.length).toBeLessThan(200_000);
  });

  it("akun tanpa data menghasilkan larik kosong, bukan null", async () => {
    const u = await createUser(pool);
    const j = await exportOf(u);
    expect(j).toMatchObject({ documents: [], orders: [], special_cases: [], reviews: [], memberships: [] });
  });
});

describe("erase_account", () => {
  async function richOwner() {
    const std = await kit.completedStandard({ member: true });
    const u = std.owner;
    const email = (await pool.query("select email from auth.users where id = $1", [u])).rows[0].email as string;
    await pool.query("update profiles set display_name = 'Sinta Hapus', utm_source = 'iklan' where id = $1", [u]);
    const loose = await kit.frozen(u);
    await message(loose.documentId, "user", "Pesan yang harus hilang");
    await message(std.v.documentId, "user", "Pesan di dokumen yang diperiksa");
    const s1 = await share(u, loose.versionId);
    const s2 = await share(u, std.v.versionId);
    await challenge(s1.id, "pihak-lain@example.test", NOW);
    await pool.query("insert into acknowledgements (share_id, email, verified_at) values ($1, 'pihak-lain@example.test', $2)", [s2.id, NOW]);
    await pool.query("insert into share_events (share_id, kind, occurred_at) values ($1, 'OPENED', $2)", [s1.id, NOW]);
    await pool.query("insert into document_exports (version_id, format, sha256, byte_size, storage_path) values ($1, 'PDF', $2, 10, $3)", [loose.versionId, hash("x"), `exports/${loose.versionId}.pdf`]);
    await pool.query("insert into document_exports (version_id, format, sha256, byte_size, storage_path) values ($1, 'PDF', $2, 10, $3)", [std.v.versionId, hash("y"), `exports/${std.v.versionId}.pdf`]);
    await pool.query("insert into evidence_packs (document_id, owner_id, sha256, byte_size, storage_path, created_at) values ($1, $2, $3, 10, $4, $5)", [loose.documentId, u, hash("z"), `evidence/${loose.documentId}.zip`, NOW]);
    await pool.query("insert into reminders (owner_id, version_id, spec_id, label, due_date, offsets, created_at) values ($1, $2, 'end', 'Akhir NDA', '2027-10-16', '{7}', $3)", [u, loose.versionId, NOW]);
    await pool.query("insert into ai_attempts (user_id, scope, occurred_at) values ($1, 'chat', $2)", [u, NOW]);
    await pool.query("select enqueue_outbox('reminder', jsonb_build_object('to', $1::text, 'label', 'Akhir NDA', 'due_date', '2027-10-16'), $2, $3)", [email, `rem-${key()}`, NOW]);
    const caseId = await closedCase(u, loose.documentId, "Ringkasan pribadi pemilik yang harus dihapus", std.f.coordinator);
    const membership = await kit.order(u, "MEMBERSHIP_MONTHLY", null);
    await pool.query("update orders set status = 'EXPIRED' where id = $1", [membership.order_id]);
    return { ...std, u, email, loose, caseId };
  }

  it("menghapus konten pemilik, menganonimkan catatan yang disimpan, verifikasi publik tetap dapat dicek", async () => {
    const o = await richOwner();
    const other = await kit.frozen(await createUser(pool));
    const shaBefore = (await pool.query("select sha256 from document_versions where id = $1", [o.v.versionId])).rows[0].sha256;
    const ordersBefore = await count("select count(*)::int as n from orders where user_id = $1", [o.u]);
    const paymentsBefore = await count("select count(*)::int as n from payments p join orders x on x.id = p.order_id where x.user_id = $1", [o.u]);

    const r = await erase(o.u);
    expect(r.status).toBe("ERASED");
    expect(r.documents_deleted).toBe(1);
    expect(r.documents_retained).toBe(1);
    expect([...r.storage_paths!].sort()).toEqual([`evidence/${o.loose.documentId}.zip`, `exports/${o.loose.versionId}.pdf`, `exports/${o.v.versionId}.pdf`].sort());

    // Dokumen tanpa jejak profesional hilang seluruhnya.
    expect(await count("select count(*)::int as n from documents where id = $1", [o.loose.documentId])).toBe(0);
    expect(await count("select count(*)::int as n from document_versions where document_id = $1", [o.loose.documentId])).toBe(0);
    // Dokumen yang diperiksa profesional: baris dan hash tetap, isi dikosongkan, judul dianonimkan.
    const kept = (await pool.query("select d.title, v.canonical_text, v.structured_data, v.sha256 from documents d join document_versions v on v.document_id = d.id where d.id = $1", [o.v.documentId])).rows[0];
    expect(kept).toMatchObject({ title: "Dokumen dihapus pemilik", canonical_text: "", structured_data: {}, sha256: shaBefore });
    const pub = (await pool.query("select * from public_verification($1)", [o.code])).rows[0];
    expect(pub).toMatchObject({ status: "ACTIVE", kind: "LEGAL", sha256: shaBefore });
    // Catatan profesional yang terbit tetap ada (karya pihak ketiga).
    expect(await count("select count(*)::int as n from legal_notes n join review_reports rp on rp.id = n.report_id where rp.request_id = $1", [o.req])).toBe(1);

    for (const [sql, label] of [
      ["select count(*)::int as n from document_messages m join documents d on d.id = m.document_id where d.owner_id = $1", "pesan"],
      ["select count(*)::int as n from share_links where created_by = $1", "tautan bagikan"],
      ["select count(*)::int as n from reminders where owner_id = $1", "pengingat"],
      ["select count(*)::int as n from evidence_packs where owner_id = $1", "paket bukti"],
      ["select count(*)::int as n from ai_attempts where user_id = $1", "percobaan AI"],
      ["select count(*)::int as n from user_roles where user_id = $1", "peran"],
      ["select count(*)::int as n from document_drafts dr join documents d on d.id = dr.document_id where d.owner_id = $1", "draf"],
    ] as const) {
      expect(await count(sql, [o.u]), label).toBe(0);
    }
    expect(await count("select count(*)::int as n from acknowledgements where email = 'pihak-lain@example.test'", [])).toBe(0);
    expect(await count("select count(*)::int as n from ack_challenges where email = 'pihak-lain@example.test'", [])).toBe(0);
    expect(await count("select count(*)::int as n from document_exports where version_id = $1", [o.v.versionId])).toBe(0);

    // Catatan keuangan dan audit tetap untuk rekonsiliasi.
    expect(await count("select count(*)::int as n from orders where user_id = $1", [o.u])).toBe(ordersBefore);
    expect(await count("select count(*)::int as n from payments p join orders x on x.id = p.order_id where x.user_id = $1", [o.u])).toBe(paymentsBefore);
    expect(await count("select count(*)::int as n from audit_events where actor_id = $1 and event_type = 'ACCOUNT_ERASED'", [o.u])).toBe(1);

    const prof = (await pool.query("select display_name, utm_source, erased_at from profiles where id = $1", [o.u])).rows[0];
    expect(prof).toMatchObject({ display_name: null, utm_source: null });
    expect(prof.erased_at).not.toBeNull();
    const sc = (await pool.query("select summary, document_id, status from special_cases where id = $1", [o.caseId])).rows[0];
    expect(sc.summary).not.toContain("pribadi");
    expect(sc).toMatchObject({ document_id: null, status: "CLOSED" });
    const ob = await count("select count(*)::int as n from outbox_events where payload::text like $1", [`%${o.email}%`]);
    expect(ob).toBe(0);
    expect(await count("select count(*)::int as n from outbox_events where payload ? 'erased' and status = 'PENDING'", [])).toBe(0);

    // Data pengguna lain tidak tersentuh.
    expect(await count("select count(*)::int as n from document_versions where id = $1", [other.versionId])).toBe(1);

    // Idempoten.
    expect((await erase(o.u)).status).toBe("ALREADY_ERASED");
    // Ekspor setelah dihapus tidak memuat isi lama.
    expect(JSON.stringify(await exportOf(o.u))).not.toContain("Pesan yang harus hilang");
  });

  it("ditolak saat Review Standar masih berjalan atau pembayaran masih menunggu; tidak ada yang berubah", async () => {
    const f = await kit.firm({ isDefault: false });
    void f;
    const u = await createUser(pool);
    const v = await kit.frozen(u);
    const b = await kit.buy(u, "STANDARD_REVIEW", v.versionId);
    expect(b.settled).toBe("SETTLED");
    const r = await erase(u);
    expect(r).toMatchObject({ status: "BLOCKED" });
    expect(r.reasons).toEqual(["STANDARD_IN_PROGRESS"]);
    expect(await count("select count(*)::int as n from document_versions where id = $1", [v.versionId])).toBe(1);
    expect((await pool.query("select erased_at from profiles where id = $1", [u])).rows[0].erased_at).toBeNull();
    expect((await pool.query("select account_erasure_blockers($1, $2) as b", [u, NOW])).rows[0].b).toEqual(["STANDARD_IN_PROGRESS"]);

    const p = await createUser(pool);
    await kit.order(p, "MEMBERSHIP_MONTHLY", null);
    expect((await erase(p)).reasons).toEqual(["PAYMENT_PENDING"]);
    // Setelah batas waktu bayar lewat, pesanan menunggu tidak lagi menahan penghapusan.
    expect((await erase(p, new Date(NOW.getTime() + 30 * DAY))).status).toBe("ERASED");
  });

  it("Kasus Hukum Khusus yang masih terbuka menahan penghapusan; setelah ditutup boleh", async () => {
    const u = await createUser(pool);
    const id = (await pool.query(
      "insert into special_cases (owner_id, summary, consent_at, idempotency_key) values ($1, 'Ringkasan kasus yang masih terbuka sekali', $2, $3) returning id",
      [u, NOW, key()],
    )).rows[0].id;
    expect((await erase(u)).reasons).toEqual(["SPECIAL_CASE_OPEN"]);
    await pool.query("update special_cases set status = 'CLOSED', closed_at = $2 where id = $1", [id, NOW]);
    expect((await erase(u)).status).toBe("ERASED");
  });

  it("pembayaran dalam pencocokan (RECONCILIATION_REQUIRED) menahan penghapusan dengan alasan sendiri", async () => {
    const u = await createUser(pool);
    const o = await kit.order(u, "MEMBERSHIP_MONTHLY", null);
    await pool.query("update orders set status = 'RECONCILIATION_REQUIRED' where id = $1", [o.order_id]);
    expect((await erase(u)).reasons).toEqual(["PAYMENT_RECONCILIATION"]);
  });

  it("Pemeriksaan Mendalam: berjalan atau ditahan dengan pesanan aktif → ditolak; ditahan tetapi dikembalikan/dibatalkan → boleh", async () => {
    const deep = async () => {
      const std = await kit.completedStandard({ member: true });
      const b = await kit.buy(std.owner, "DEEP_REVIEW", std.req);
      expect(b.settled).toBe("SETTLED");
      const id = (await pool.query("select id from deep_requests where order_id = $1", [b.order_id])).rows[0].id as string;
      return { owner: std.owner, id, orderId: b.order_id, paymentId: b.paymentId };
    };
    const running = await deep();
    expect((await erase(running.owner)).reasons).toEqual(["DEEP_IN_PROGRESS"]);

    const held = await deep();
    await pool.query("update deep_requests set status = 'ON_HOLD' where id = $1", [held.id]);
    expect((await erase(held.owner)).reasons).toEqual(["DEEP_IN_PROGRESS"]);

    const refunded = await deep();
    await pool.query("update deep_requests set status = 'ON_HOLD' where id = $1", [refunded.id]);
    await pool.query("update orders set status = 'CANCELLED' where id = $1", [refunded.orderId]);
    await pool.query("update payments set status = 'REFUNDED' where id = $1", [refunded.paymentId]);
    expect((await erase(refunded.owner)).status).toBe("ERASED");

    const closed = await deep();
    await pool.query("update deep_requests set status = 'ON_HOLD' where id = $1", [closed.id]);
    await pool.query("update orders set status = 'CANCELLED' where id = $1", [closed.orderId]);
    expect((await erase(closed.owner)).status).toBe("ERASED");
  });

  it("setiap fungsi migrasi 34 (dan gerbang kekekalan) memakai search_path tetap", async () => {
    const { rows } = await pool.query(
      "select proname, proconfig from pg_proc where pronamespace = 'public'::regnamespace and proname = any($1)",
      [["forbid_immutable_change", "run_retention", "export_account_data", "account_erasure_blockers", "erase_account"]],
    );
    expect(rows.map((r) => r.proname).sort()).toEqual(["account_erasure_blockers", "erase_account", "export_account_data", "forbid_immutable_change", "run_retention"]);
    for (const r of rows) expect(r.proconfig ?? [], r.proname).toContain("search_path=public");
  });

  it("akun profesional/admin tidak dapat menghapus diri lewat jalur ini", async () => {
    const f = await kit.firm();
    const rv = await f.addReviewer();
    expect((await erase(rv.reviewer)).reasons).toContain("STAFF_ACCOUNT");
    expect((await erase(f.admin)).reasons).toContain("STAFF_ACCOUNT");
    expect((await erase(f.coordinator)).reasons).toContain("STAFF_ACCOUNT");
  });

  it("kekekalan versi tetap berlaku di luar fungsi penghapusan", async () => {
    const v = await kit.frozen(await createUser(pool));
    await expect(pool.query("update document_versions set canonical_text = '' where id = $1", [v.versionId])).rejects.toThrow(/immutable/);
    // Menyetel penanda sesi sendiri tidak membuka gerbang: penanda terikat pada transaksi fungsi penghapusan.
    const c = await pool.connect();
    try {
      await c.query("begin");
      await c.query("select set_config('yuktanya.erasure', 'on', true)");
      await expect(c.query("update document_versions set canonical_text = '' where id = $1", [v.versionId])).rejects.toThrow(/immutable/);
    } finally {
      await c.query("rollback");
      c.release();
    }
  });
});

describe("lapisan aplikasi di atas Postgres", () => {
  it("job retensi: tanpa/salah rahasia ditolak, rahasia benar menjalankan retensi", async () => {
    const call = (h?: string) => retentionJobHandler({ pool, secret: "rahasia-panjang-123", now: () => NOW }, new Request("http://t/api/jobs/retention", { headers: h ? { authorization: h } : {} }));
    expect((await call()).status).toBe(401);
    expect((await call("Bearer salah")).status).toBe(401);
    const res = await call("Bearer rahasia-panjang-123");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ai_attempts: expect.any(Number), ack_challenges: expect.any(Number), more: false });
  });

  it("eraseAccount: berkas privat ikut terhapus, lalu akun Auth dihapus lewat adapter", async () => {
    const blob = createFsBlobStore(mkdtempSync(path.join(tmpdir(), "erase-")));
    const u = await kit.member("2026-10-01", "2027-12-01");
    const v = await kit.frozen(u);
    const p = `exports/${v.versionId}.pdf`;
    await blob.put(p, new Uint8Array([1, 2, 3]));
    await pool.query("insert into document_exports (version_id, format, sha256, byte_size, storage_path) values ($1, 'PDF', $2, 3, $3)", [v.versionId, hash("e"), p]);
    const deleted: string[] = [];
    const r = await eraseAccount({ pool, blob, auth: { deleteUser: async (id) => void deleted.push(id) } }, u, NOW);
    expect(r).toEqual({ status: "ERASED", filesFailed: 0, authDeleted: true });
    expect(await blob.get(p)).toBeNull();
    expect(deleted).toEqual([u]);
  });
});

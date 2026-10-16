import type { Pool } from "pg";
import { createPgDocumentsService } from "@/lib/documents/service";
import type { Data } from "@/lib/documents/types";
import { createUser } from "./helpers";

export const NOW = new Date("2026-10-16T05:00:00Z");
export const at = (minutes: number, base: Date = NOW) => new Date(base.getTime() + minutes * 60_000);
export const key = () => `k-${Math.random().toString(36).slice(2)}-abcdef`;
export const ndaData: Data = {
  disclosingParty: "Sinta Dewi", receivingParty: "Budi Santoso", signingDate: "2026-10-16", confidentialInfo: "ZZ-RAHASIA",
  purpose: "Evaluasi", termMonths: 24, disputeCity: "Jakarta",
};

export function makeKit(pool: Pool) {
  const docs = createPgDocumentsService(pool, { ALLOW_UNAPPROVED_TEMPLATES: "true", NODE_ENV: "test" });
  return {
    docs,
    async member(start = "2026-10-01", end = "2026-11-01") {
      const u = await createUser(pool);
      await pool.query("insert into memberships(user_id, status, period_start, period_end) values ($1, 'ACTIVE', $2, $3)", [u, start, end]);
      return u;
    },
    async admin() {
      return createUser(pool, { roles: ["platform_admin"] });
    },
    async frozen(u: string, d: Data = ndaData) {
      const { documentId } = await docs.create(u, "NDA", key());
      const detail = (await docs.get(u, documentId))!;
      await docs.saveDraft(u, documentId, d, detail.draft.revision);
      const r = await docs.freeze(u, documentId, key(), NOW);
      if (!r.ok) throw new Error("freeze gagal");
      return { documentId, versionId: r.versionId };
    },
    async order(u: string, kind: string, ref: string | null, now: Date = NOW, k: string = key()) {
      const { rows } = await pool.query("select * from create_order($1, $2, $3, $4, $5)", [u, kind, ref, k, now]);
      return rows[0] as { order_id: string; status: string; amount_idr: number; duplicate: boolean };
    },
    async pay(u: string, orderId: string, provider = "mock", now: Date = NOW) {
      const ref = `ref-${Math.random().toString(36).slice(2)}`;
      const { rows } = await pool.query("select create_payment($1, $2, $3, $4, $5) as id", [u, orderId, provider, ref, now]);
      return { paymentId: rows[0].id as string, ref };
    },
    async settle(provider: string, ref: string, amount: number, now: Date = NOW, event = `ev-${Math.random().toString(36).slice(2)}`, fee = 0) {
      return (await pool.query("select settle_payment($1, $2, $3, $4, $5, $6) as r", [provider, ref, event, amount, fee, now])).rows[0].r as string;
    },
    // Order → pembayaran → settlement sukses.
    async buy(u: string, kind: string, ref: string | null, now: Date = NOW) {
      const o = await this.order(u, kind, ref, now);
      const p = await this.pay(u, o.order_id, "mock", now);
      const r = await this.settle("mock", p.ref, o.amount_idr, now);
      return { ...o, ...p, settled: r };
    },
    // Review standar selesai WITH_NOTES (satu catatan aktionabel) → siap untuk penawaran Deep Review.
    async completedStandard(opts: { severity?: "MINOR" | "MATERIAL"; actionable?: boolean; owner?: string; member?: boolean } = {}) {
      await pool.query("update firms set is_default = false");
      const f = await this.firm({ isDefault: true });
      const r = await f.addReviewer();
      const owner = opts.owner ?? (opts.member ? await this.member("2026-10-01", "2027-12-01") : await createUser(pool));
      const v = await this.frozen(owner);
      const b = await this.buy(owner, "STANDARD_REVIEW", v.versionId);
      const req = (await pool.query("select id from review_requests where order_id = $1", [b.order_id])).rows[0].id as string;
      await pool.query("select assign_review($1, $2, $3, $4)", [f.coordinator, req, r.reviewer, NOW]);
      const s = (await pool.query("select * from start_review($1, $2, $3)", [r.reviewer, req, NOW])).rows[0];
      let rev = (await pool.query("select save_report_draft($1, $2, $3, 'Klausul kerahasiaan', 'Data benar', '', $4) as r", [r.reviewer, req, s.revision, NOW])).rows[0].r as number;
      const sev = opts.severity ?? "MATERIAL";
      const note = { title: "Jangka waktu", finding: "Tidak jelas", severity: sev, actionable: opts.actionable ?? true, recommended_action: "Perjelas", rationale: "Risiko sengketa", escalation: "Konsultasi lanjutan" };
      rev = (await pool.query("select * from upsert_note($1, $2, $3, $4, $5)", [r.reviewer, req, rev, JSON.stringify(note), NOW])).rows[0].revision as number;
      const pub = (await pool.query("select * from publish_standard($1, $2, $3, 'WITH_NOTES', false, true, $4)", [r.reviewer, req, rev, NOW])).rows[0] as { verification_id: string; code: string };
      return { f, r, owner, v, req, verificationId: pub.verification_id, code: pub.code };
    },
    // Firma bawaan + koordinator + reviewer berotorisasi.
    async firm(opts: { isDefault?: boolean } = {}) {
      const admin = await this.admin();
      const firmId = (await pool.query("select admin_register_firm($1, $2, $3) as id", [admin, `Firma ${Math.random().toString(36).slice(2)}`, opts.isDefault ?? false])).rows[0].id as string;
      const coordinator = await createUser(pool);
      await pool.query("select admin_add_member($1, $2, $3, 'coordinator')", [admin, firmId, coordinator]);
      const addReviewer = async (from = "2026-01-01", to = "2027-12-31") => {
        const r = await createUser(pool);
        await pool.query("select admin_add_member($1, $2, $3, 'reviewer')", [admin, firmId, r]);
        const authId = (await pool.query("select admin_authorize($1, $2, $3, 'Kontrak komersial', $4, $5) as id", [admin, r, firmId, from, to])).rows[0].id as string;
        return { reviewer: r, authId };
      };
      return { admin, firmId, coordinator, addReviewer };
    },
  };
}

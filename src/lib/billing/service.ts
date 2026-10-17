import type { Pool } from "pg";
import type { PaymentAdapter } from "./adapters";
import { confirmAndApply, MIN_PAYMENT_MINUTES, type GatewayAction, type MidtransConfig } from "./midtrans";

export type OrderKind = "MEMBERSHIP_MONTHLY" | "MEMBERSHIP_ANNUAL" | "BUNDLE" | "STANDARD_REVIEW" | "DEEP_REVIEW";
export const ORDER_KINDS: readonly OrderKind[] = ["MEMBERSHIP_MONTHLY", "MEMBERSHIP_ANNUAL", "BUNDLE", "STANDARD_REVIEW", "DEEP_REVIEW"];
export type Quote = { amountIdr: number; variant: string; usesCredit: boolean };
export type OrderResult = { orderId: string; status: string; amountIdr: number; duplicate: boolean };
export type OrderView = {
  id: string; kind: OrderKind; refId: string | null; status: string; amountIdr: number; variant: string | null;
  expiresAt: string; createdAt: string; paidAt: string | null; payments: { id: string; provider: string; status: string }[];
};

export type ManualPending = { paymentId: string; orderId: string; kind: string; amountIdr: number; createdAt: string; orderStatus: string; expired: boolean };
export type ReconciliationItem = { orderId: string; paymentId: string | null; status: string; amountIdr: number; createdAt: string; extraPayment: boolean };

export class BillingError extends Error {
  constructor(readonly code: "NOT_ELIGIBLE" | "NOTE_REQUIRED" | "NOT_RECONCILIATION" | "AMOUNT_MISMATCH" | "CONFLICT" | "INVALID_ACTION" | "NOT_FOUND" | "ALREADY_REVIEWED" | "PRODUCT_UNAVAILABLE" | "ORDER_NOT_PAYABLE" | "INVALID_KIND" | "FORBIDDEN" | "PROVIDER_UNAVAILABLE" | "PROVIDER_ERROR" | "ORDER_EXPIRING" | "SPECIAL_CASE_OPEN" | "DISCOUNT_TAKEN", readonly reason?: string) {
    super(reason ? `${code}: ${reason}` : code);
    this.name = "BillingError";
  }
}
const CODES = ["SPECIAL_CASE_OPEN", "NOT_FOUND", "ALREADY_REVIEWED", "PRODUCT_UNAVAILABLE", "ORDER_NOT_PAYABLE", "INVALID_KIND", "FORBIDDEN"] as const;
function mapError(e: unknown): never {
  const m = e instanceof Error ? e.message : "";
  const el = /NOT_ELIGIBLE: ([A-Z_]+)/.exec(m);
  if (el) throw new BillingError("NOT_ELIGIBLE", el[1]);
  for (const c of CODES) if (m.includes(c)) throw new BillingError(c);
  throw e;
}

export interface BillingService {
  preview(userId: string, kind: OrderKind, refId: string | null, now?: Date): Promise<Quote>;
  createOrder(userId: string, kind: OrderKind, refId: string | null, key: string, now?: Date): Promise<OrderResult>;
  // Adaptor hosted (Midtrans): redirectUrl = halaman bayar penyedia; klik ulang selama masih PENDING memakai URL yang sama.
  startPayment(userId: string, orderId: string, provider: string, now?: Date): Promise<{ paymentId: string; instructions: string; redirectUrl?: string }>;
  // Status penyedia yang SUDAH dikonfirmasi lewat API penyedia → fungsi DB (settle/fail/record). Idempoten per eventId.
  // amountIdr null = jumlah tidak terbaca → diperlakukan sebagai tidak cocok (rekonsiliasi).
  applyProviderStatus(provider: "midtrans", providerRef: string, eventId: string, action: GatewayAction, amountIdr: number | null, now?: Date): Promise<string>;
  // Tombol "Perbarui status": konfirmasi ulang ke API Midtrans untuk pembayaran PENDING milik pengguna pada pesanan ini,
  // serta pembayaran FAILED selama pesanan masih menunggu pembayaran (ditolak lalu ternyata berhasil).
  refreshHosted(userId: string, orderId: string, cfg: MidtransConfig, fetchImpl?: typeof fetch, now?: Date): Promise<string[]>;
  getOrder(userId: string, orderId: string): Promise<OrderView | null>;
  listOrders(userId: string): Promise<OrderView[]>;
  // Hanya non-produksi: mensimulasikan webhook gateway untuk pembayaran milik pengguna.
  mockSettle(userId: string, paymentId: string, now?: Date): Promise<string>;
  confirmManual(adminId: string, paymentId: string, bankRef: string, amountIdr: number, receivedAt?: Date | null, now?: Date): Promise<string>;
  resolveReconciliation(adminId: string, orderId: string, action: "ACTIVATE" | "REFUND_RECORDED" | "CLOSE", note: string, now?: Date): Promise<string>;
  // Transfer manual yang menunggu konfirmasi, termasuk yang ordernya sudah lunas lewat pembayaran lain atau sudah kedaluwarsa
  // (30 hari terakhir): dana yang benar-benar masuk tetap dapat dikonfirmasi dan berakhir di rekonsiliasi, bukan hilang.
  pendingManualPayments(now?: Date): Promise<ManualPending[]>;
  // Order yang perlu rekonsiliasi, plus pembayaran tambahan (DISPUTED) pada order yang sudah lunas atau sudah dibatalkan.
  reconciliation(): Promise<ReconciliationItem[]>;
}

export function createPgBillingService(pool: Pool, adapters: PaymentAdapter[]): BillingService {
  const byName = new Map(adapters.map((a) => [a.name, a]));
  const mapOrder = (r: Record<string, unknown>, payments: { id: string; provider: string; status: string }[]): OrderView => ({
    id: r.id as string, kind: r.kind as OrderKind, refId: (r.ref_id as string | null) ?? null, status: r.status as string, amountIdr: r.amount_idr as number,
    variant: ((r.price_snapshot as { variant?: string } | null)?.variant) ?? null, expiresAt: (r.expires_at as Date).toISOString(),
    createdAt: (r.created_at as Date).toISOString(), paidAt: r.paid_at ? (r.paid_at as Date).toISOString() : null, payments,
  });
  async function paymentsFor(ids: string[]) {
    if (ids.length === 0) return new Map<string, { id: string; provider: string; status: string }[]>();
    const { rows } = await pool.query("select id, order_id, provider, status from payments where order_id = any($1) order by created_at", [ids]);
    const m = new Map<string, { id: string; provider: string; status: string }[]>();
    for (const r of rows) m.set(r.order_id, [...(m.get(r.order_id) ?? []), { id: r.id, provider: r.provider, status: r.status }]);
    return m;
  }
  // Kegagalan pencatatan audit tidak boleh mengubah jawaban ke pengguna; tetap dilaporkan ke log server.
  async function recordDeepRejection(actorId: string, parent: string, reason: string, stage: "ORDER" | "RECONCILIATION", now: Date) {
    try {
      await pool.query("select record_deep_eligibility_rejection($1, $2, $3, $4, $5)", [actorId, parent, reason, stage, now]);
    } catch (err) {
      console.error("audit penolakan kelayakan Deep gagal", err instanceof Error ? err.message : err);
    }
  }
  const svc: BillingService = {
    async preview(userId, kind, refId, now = new Date()) {
      try {
        const { rows } = await pool.query("select * from preview_price($1, $2, $3, $4)", [userId, kind, refId, now]);
        return { amountIdr: rows[0].amount_idr, variant: rows[0].variant, usesCredit: rows[0].uses_credit };
      } catch (e) {
        return mapError(e);
      }
    },
    async createOrder(userId, kind, refId, key, now = new Date()) {
      try {
        const { rows } = await pool.query("select * from create_order($1, $2, $3, $4, $5)", [userId, kind, refId, key, now]);
        return { orderId: rows[0].order_id, status: rows[0].status, amountIdr: rows[0].amount_idr, duplicate: rows[0].duplicate };
      } catch (e) {
        // Penolakan kelayakan Deep membatalkan transaksi order; jejak auditnya dicatat sesudahnya (hanya kode alasan).
        const el = /NOT_ELIGIBLE: ([A-Z_]+)/.exec(e instanceof Error ? e.message : "");
        if (el && kind === "DEEP_REVIEW" && refId) await recordDeepRejection(userId, refId, el[1], "ORDER", now);
        return mapError(e);
      }
    },
    async startPayment(userId, orderId, provider, now = new Date()) {
      const adapter = byName.get(provider as PaymentAdapter["name"]);
      if (!adapter) throw new BillingError("PROVIDER_UNAVAILABLE");
      const { rows: o } = await pool.query("select id, amount_idr, kind, status, expires_at from orders where id = $1 and user_id = $2", [orderId, userId]);
      if (!o[0]) throw new BillingError("NOT_FOUND");
      if (adapter.hosted) {
        // Pra-periksa sebelum memanggil penyedia, dengan sumber yang sama dengan create_payment (payment_blocker; create_payment
        // tetap pemeriksa akhir): pesanan yang akan ditolak DB tidak membuat transaksi Midtrans yatim.
        const block = (await pool.query("select payment_blocker($1, $2, $3) as r", [userId, orderId, now])).rows[0].r as string | null;
        if (block === "NOT_FOUND" || block === "ORDER_NOT_PAYABLE" || block === "SPECIAL_CASE_OPEN") throw new BillingError(block);
        if (block) throw new BillingError("ORDER_NOT_PAYABLE");
        if ((o[0].expires_at as Date).getTime() - now.getTime() < MIN_PAYMENT_MINUTES * 60_000) throw new BillingError("ORDER_EXPIRING");
        const { rows: ex } = await pool.query(
          "select id, provider_ref, checkout_url from payments where order_id = $1 and provider = $2 and status = 'PENDING' and checkout_url is not null order by created_at",
          [orderId, provider],
        );
        for (const p of ex) {
          let origin: string | null = null;
          try {
            origin = new URL(p.checkout_url).origin;
          } catch {
            origin = null;
          }
          if (origin && (adapter.redirectOrigins ?? []).includes(origin)) return { paymentId: p.id, instructions: "", redirectUrl: p.checkout_url };
          // URL dari asal Snap yang tidak aktif lagi (mis. Sandbox setelah pindah ke Production): pembayaran PENDING itu ditutup
          // lewat fail_payment (hanya PENDING yang berubah; dana VERIFIED tidak pernah disentuh), lalu transaksi baru dibuat.
          await pool.query("select fail_payment($1, $2, $3, 'EXPIRED', $4)", [provider, p.provider_ref, `stale-origin:${p.provider_ref}`, now]);
        }
      }
      let charge;
      try {
        charge = await adapter.createCharge({ id: o[0].id, amountIdr: o[0].amount_idr, kind: o[0].kind, expiresAt: o[0].expires_at, now });
      } catch (e) {
        // Galat penyedia: belum ada baris pembayaran apa pun. Log hanya kode/nama galat (tanpa kunci, tanpa data pengguna).
        console.error("pembuatan transaksi penyedia gagal", provider, e instanceof Error ? e.message.slice(0, 300) : "unknown");
        throw new BillingError("PROVIDER_ERROR");
      }
      try {
        if (charge.redirectUrl) {
          const { rows } = await pool.query("select * from create_hosted_payment($1, $2, $3, $4, $5, $6)", [userId, orderId, provider, charge.providerRef, charge.redirectUrl, now]);
          return { paymentId: rows[0].payment_id, instructions: charge.instructions, redirectUrl: rows[0].checkout_url };
        }
        const { rows } = await pool.query("select create_payment($1, $2, $3, $4, $5) as id", [userId, orderId, provider, charge.providerRef, now]);
        return { paymentId: rows[0].id, instructions: charge.instructions };
      } catch (e) {
        return mapError(e);
      }
    },
    async applyProviderStatus(provider, providerRef, eventId, action, amountIdr, now = new Date()) {
      if (action.kind === "SETTLE") {
        if (amountIdr === null) console.error("jumlah penyedia tidak terbaca; pembayaran masuk rekonsiliasi", provider, providerRef);
        const { rows } = await pool.query("select settle_payment($1, $2, $3, $4, 0, $5) as r", [provider, providerRef, eventId, amountIdr ?? 0, now]);
        return rows[0].r;
      }
      if (action.kind === "FAIL") {
        const { rows } = await pool.query("select fail_payment($1, $2, $3, $4, $5) as r", [provider, providerRef, eventId, action.status, now]);
        return rows[0].r;
      }
      const { rows } = await pool.query("select record_payment_event($1, $2, $3, $4) as r", [provider, providerRef, eventId, now]);
      return rows[0].r;
    },
    async refreshHosted(userId, orderId, cfg, fetchImpl = fetch, now = new Date()) {
      const { rows } = await pool.query(
        `select p.provider_ref from payments p join orders o on o.id = p.order_id
          where o.id = $1 and o.user_id = $2 and p.provider = 'midtrans'
            and (p.status = 'PENDING' or (p.status = 'FAILED' and o.status = 'PENDING_PAYMENT')) order by p.created_at`,
        [orderId, userId],
      );
      const out: string[] = [];
      for (const r of rows) {
        const res = await confirmAndApply(cfg, r.provider_ref, (a, ev, amt) => svc.applyProviderStatus("midtrans", r.provider_ref, ev, a, amt, now), fetchImpl);
        out.push(res ?? "NOT_FOUND");
      }
      return out;
    },
    async getOrder(userId, orderId) {
      const { rows } = await pool.query("select * from orders where id = $1 and user_id = $2", [orderId, userId]);
      if (!rows[0]) return null;
      return mapOrder(rows[0], (await paymentsFor([orderId])).get(orderId) ?? []);
    },
    async listOrders(userId) {
      const { rows } = await pool.query("select * from orders where user_id = $1 order by created_at desc limit 50", [userId]);
      const pays = await paymentsFor(rows.map((r) => r.id));
      return rows.map((r) => mapOrder(r, pays.get(r.id) ?? []));
    },
    async mockSettle(userId, paymentId, now = new Date()) {
      const { rows } = await pool.query(
        "select p.provider_ref, p.amount_idr from payments p join orders o on o.id = p.order_id where p.id = $1 and o.user_id = $2 and p.provider = 'mock'",
        [paymentId, userId],
      );
      if (!rows[0]) throw new BillingError("NOT_FOUND");
      const r = await pool.query("select settle_payment('mock', $1, $2, $3, 0, $4) as r", [rows[0].provider_ref, `mock:${paymentId}`, rows[0].amount_idr, now]);
      return r.rows[0].r;
    },
    async confirmManual(adminId, paymentId, bankRef, amountIdr, receivedAt = null, now = new Date()) {
      try {
        const { rows } = await pool.query("select confirm_manual_payment($1, $2, $3, $4, $5, $6) as r", [adminId, paymentId, bankRef, amountIdr, now, receivedAt]);
        return rows[0].r;
      } catch (e) {
        return mapError(e);
      }
    },

    async resolveReconciliation(adminId, orderId, action, note, now = new Date()) {
      try {
        const { rows } = await pool.query("select admin_resolve_reconciliation($1, $2, $3, $4, $5) as r", [adminId, orderId, action, note, now]);
        return rows[0].r;
      } catch (e) {
        const m = e instanceof Error ? e.message : "";
        if (/NOT_ELIGIBLE/.test(m)) {
          const o = (await pool.query("select user_id, ref_id from orders where id = $1 and kind = 'DEEP_REVIEW'", [orderId])).rows[0];
          if (o?.ref_id) {
            const why = (await pool.query("select reason from deep_eligibility($1, $2, $3, $4)", [o.user_id, o.ref_id, now, orderId])).rows[0]?.reason;
            // Aktor audit = admin yang memutuskan rekonsiliasi (pemilik order tidak melakukan apa pun di tahap ini).
            await recordDeepRejection(adminId, o.ref_id, typeof why === "string" ? why : "UNKNOWN", "RECONCILIATION", now);
          }
          throw new BillingError("NOT_ELIGIBLE", "PARENT_CHANGED");
        }
        for (const c of ["NOTE_REQUIRED", "NOT_RECONCILIATION", "AMOUNT_MISMATCH", "CONFLICT", "INVALID_ACTION", "DISCOUNT_TAKEN"] as const) if (m.includes(c)) throw new BillingError(c);
        return mapError(e);
      }
    },
    async pendingManualPayments(now = new Date()) {
      const { rows } = await pool.query(
        `select p.id, p.order_id, o.kind, p.amount_idr, p.created_at, p.status, o.status as order_status
           from payments p join orders o on o.id = p.order_id
          where p.provider = 'manual'
            and (p.status = 'PENDING' or (p.status = 'EXPIRED' and o.status = 'EXPIRED' and o.expires_at > $1::timestamptz - interval '30 days'))
          order by p.created_at`,
        [now],
      );
      return rows.map((r) => ({
        paymentId: r.id, orderId: r.order_id, kind: r.kind, amountIdr: r.amount_idr, createdAt: r.created_at.toISOString(),
        orderStatus: r.order_status, expired: r.status === "EXPIRED",
      }));
    },
    async reconciliation() {
      const { rows } = await pool.query(
        `select o.id as order_id, (select p.id from payments p where p.order_id = o.id order by p.created_at desc limit 1) as payment_id,
                o.status, o.amount_idr, o.created_at, false as extra
           from orders o where o.status = 'RECONCILIATION_REQUIRED'
         union all
         select o.id, p.id, o.status, coalesce(p.received_amount_idr, p.amount_idr), coalesce(p.received_at, p.created_at), true
           from payments p join orders o on o.id = p.order_id where p.status = 'DISPUTED' and o.status in ('PAID', 'CANCELLED')
         order by 5`,
      );
      return rows.map((r) => ({
        orderId: r.order_id, paymentId: r.payment_id, status: r.status, amountIdr: r.amount_idr, createdAt: r.created_at.toISOString(), extraPayment: r.extra,
      }));
    },
  };
  return svc;
}

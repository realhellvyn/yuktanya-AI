import type { Pool } from "pg";
import type { PaymentAdapter } from "./adapters";

export type OrderKind = "MEMBERSHIP_MONTHLY" | "MEMBERSHIP_ANNUAL" | "BUNDLE" | "STANDARD_REVIEW" | "DEEP_REVIEW";
export const ORDER_KINDS: readonly OrderKind[] = ["MEMBERSHIP_MONTHLY", "MEMBERSHIP_ANNUAL", "BUNDLE", "STANDARD_REVIEW", "DEEP_REVIEW"];
export type Quote = { amountIdr: number; variant: string; usesCredit: boolean };
export type OrderResult = { orderId: string; status: string; amountIdr: number; duplicate: boolean };
export type OrderView = {
  id: string; kind: OrderKind; refId: string | null; status: string; amountIdr: number; variant: string | null;
  expiresAt: string; createdAt: string; paidAt: string | null; payments: { id: string; provider: string; status: string }[];
};

export class BillingError extends Error {
  constructor(readonly code: "NOT_ELIGIBLE" | "NOTE_REQUIRED" | "NOT_RECONCILIATION" | "AMOUNT_MISMATCH" | "CONFLICT" | "INVALID_ACTION" | "NOT_FOUND" | "ALREADY_REVIEWED" | "PRODUCT_UNAVAILABLE" | "ORDER_NOT_PAYABLE" | "INVALID_KIND" | "FORBIDDEN" | "PROVIDER_UNAVAILABLE", readonly reason?: string) {
    super(reason ? `${code}: ${reason}` : code);
    this.name = "BillingError";
  }
}
const CODES = ["NOT_FOUND", "ALREADY_REVIEWED", "PRODUCT_UNAVAILABLE", "ORDER_NOT_PAYABLE", "INVALID_KIND", "FORBIDDEN"] as const;
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
  startPayment(userId: string, orderId: string, provider: string, now?: Date): Promise<{ paymentId: string; instructions: string }>;
  getOrder(userId: string, orderId: string): Promise<OrderView | null>;
  listOrders(userId: string): Promise<OrderView[]>;
  // Hanya non-produksi: mensimulasikan webhook gateway untuk pembayaran milik pengguna.
  mockSettle(userId: string, paymentId: string, now?: Date): Promise<string>;
  confirmManual(adminId: string, paymentId: string, bankRef: string, amountIdr: number, receivedAt?: Date | null, now?: Date): Promise<string>;
  resolveReconciliation(adminId: string, orderId: string, action: "ACTIVATE" | "REFUND_RECORDED" | "CLOSE", note: string, now?: Date): Promise<string>;
  pendingManualPayments(): Promise<{ paymentId: string; orderId: string; kind: string; amountIdr: number; createdAt: string }[]>;
  reconciliation(): Promise<{ orderId: string; paymentId: string | null; status: string; amountIdr: number; createdAt: string }[]>;
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
  return {
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
        return mapError(e);
      }
    },
    async startPayment(userId, orderId, provider, now = new Date()) {
      const adapter = byName.get(provider as "mock" | "manual");
      if (!adapter) throw new BillingError("PROVIDER_UNAVAILABLE");
      const { rows: o } = await pool.query("select id, amount_idr from orders where id = $1 and user_id = $2", [orderId, userId]);
      if (!o[0]) throw new BillingError("NOT_FOUND");
      const charge = await adapter.createCharge({ id: o[0].id, amountIdr: o[0].amount_idr });
      try {
        const { rows } = await pool.query("select create_payment($1, $2, $3, $4, $5) as id", [userId, orderId, provider, charge.providerRef, now]);
        return { paymentId: rows[0].id, instructions: charge.instructions };
      } catch (e) {
        return mapError(e);
      }
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
        for (const c of ["NOTE_REQUIRED", "NOT_RECONCILIATION", "AMOUNT_MISMATCH", "CONFLICT", "INVALID_ACTION"] as const) if (m.includes(c)) throw new BillingError(c);
        return mapError(e);
      }
    },
    async pendingManualPayments() {
      const { rows } = await pool.query(
        "select p.id, p.order_id, o.kind, p.amount_idr, p.created_at from payments p join orders o on o.id = p.order_id where p.provider = 'manual' and p.status = 'PENDING' and o.status = 'PENDING_PAYMENT' order by p.created_at",
      );
      return rows.map((r) => ({ paymentId: r.id, orderId: r.order_id, kind: r.kind, amountIdr: r.amount_idr, createdAt: r.created_at.toISOString() }));
    },
    async reconciliation() {
      const { rows } = await pool.query(
        "select o.id as order_id, (select p.id from payments p where p.order_id = o.id order by p.created_at desc limit 1) as payment_id, o.status, o.amount_idr, o.created_at from orders o where o.status = 'RECONCILIATION_REQUIRED' order by o.created_at",
      );
      return rows.map((r) => ({ orderId: r.order_id, paymentId: r.payment_id, status: r.status, amountIdr: r.amount_idr, createdAt: r.created_at.toISOString() }));
    },
  };
}

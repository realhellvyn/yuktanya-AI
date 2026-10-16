import { formatIdr } from "@/lib/pricing/catalog";
import type { OrderView } from "@/lib/billing/service";

const STATUS: Record<string, string> = {
  PENDING_PAYMENT: "Menunggu pembayaran",
  PAID: "Pembayaran dikonfirmasi",
  EXPIRED: "Kedaluwarsa",
  CANCELLED: "Dibatalkan",
  RECONCILIATION_REQUIRED: "Sedang diperiksa tim kami",
};

export function OrderStatus({ order }: { order: Pick<OrderView, "status" | "amountIdr" | "expiresAt"> }) {
  return (
    <div className="space-y-1 rounded-lg border border-line bg-white p-4">
      <p role="status" className="text-lg font-semibold">Status: {STATUS[order.status] ?? order.status}</p>
      <p>Jumlah: {formatIdr(order.amountIdr)}</p>
      {order.status === "PENDING_PAYMENT" && <p>Selesaikan pembayaran sebelum {new Date(order.expiresAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "long", timeStyle: "short" })} WIB.</p>}
      {order.status === "RECONCILIATION_REQUIRED" && <p>Pembayaran Anda sudah kami terima dan sedang dicocokkan. Tim kami akan menghubungi Anda.</p>}
    </div>
  );
}

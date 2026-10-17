import { formatIdr } from "@/lib/pricing/catalog";
import type { OrderView } from "@/lib/billing/service";

const STATUS: Record<string, string> = {
  PENDING_PAYMENT: "Menunggu pembayaran",
  PAID: "Pembayaran dikonfirmasi",
  EXPIRED: "Kedaluwarsa",
  CANCELLED: "Dibatalkan",
  RECONCILIATION_REQUIRED: "Sedang dicocokkan tim kami",
};

type OrderLike = Pick<OrderView, "status" | "amountIdr" | "expiresAt">;

// Order yang masih PENDING_PAYMENT di database tetapi batas waktunya sudah lewat (sapuan kedaluwarsa belum berjalan):
// ditampilkan lewat batas waktu saat dirender, tanpa instruksi transfer lama.
export const isPastDue = (order: OrderLike, now: Date = new Date()) =>
  order.status === "PENDING_PAYMENT" && new Date(order.expiresAt).getTime() <= now.getTime();

export function OrderStatus({ order, now = new Date() }: { order: OrderLike; now?: Date }) {
  const pastDue = isPastDue(order, now);
  return (
    <div className="space-y-1 rounded-lg border border-line bg-surface p-4">
      <p role="status" className="text-lg font-semibold">Status: {pastDue ? "Batas waktu pembayaran lewat" : STATUS[order.status] ?? "Sedang diproses"}</p>
      <p>Jumlah: {formatIdr(order.amountIdr)}</p>
      {pastDue && <p>Pesanan ini tidak dapat dibayar lagi. Untuk melanjutkan, buat pengajuan baru dari halaman dokumen atau halaman Membership. Bila Anda sudah telanjur mentransfer, jangan mentransfer lagi. Tim kami akan mencocokkan transfer yang masuk.</p>}
      {order.status === "PENDING_PAYMENT" && !pastDue && <p>Selesaikan pembayaran sebelum {new Date(order.expiresAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "long", timeStyle: "short" })} WIB.</p>}
      {order.status === "RECONCILIATION_REQUIRED" && <p>Pembayaran Anda sudah kami terima dan sedang dicocokkan. Tim kami akan menghubungi Anda.</p>}
    </div>
  );
}

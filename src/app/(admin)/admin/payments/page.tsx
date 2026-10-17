import { PageHeading } from "@/components/ui/card";
import { fieldClass, labelText } from "@/components/ui/field";
import { buttonClass } from "@/components/ui/button";
import { billingService } from "@/lib/billing/runtime";
import { formatIdr } from "@/lib/pricing/catalog";
import { adminPaymentErrorText, adminPaymentResultText } from "@/lib/billing/admin-messages";
import { paymentReference } from "@/lib/reviews/paths";
import { confirmManualAction, resolveReconciliationAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pembayaran | Admin Yuktanya" };
const KIND: Record<string, string> = { MEMBERSHIP_MONTHLY: "Membership 1 periode", MEMBERSHIP_ANNUAL: "Membership 1 tahun", BUNDLE: "Paket kredit", STANDARD_REVIEW: "Pemeriksaan Standar", DEEP_REVIEW: "Deep Review" };

export default async function AdminPaymentsPage({ searchParams }: { searchParams: Promise<{ r?: string; e?: string }> }) {
  const q = await searchParams;
  const svc = billingService();
  const [pending, recon] = await Promise.all([svc.pendingManualPayments(), svc.reconciliation()]);
  return (
    <main className="max-w-5xl space-y-6">
      <PageHeading title="Pembayaran" />
      {adminPaymentResultText(q.r) && <p role="status" className="rounded-xl border border-green-300 bg-green-50 p-4 font-semibold text-green-900">{adminPaymentResultText(q.r)}</p>}
      {adminPaymentErrorText(q.e) && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 font-semibold text-danger">{adminPaymentErrorText(q.e)}</p>}
      <section aria-labelledby="menunggu-h" className="space-y-3">
        <h2 id="menunggu-h" className="text-xl font-bold text-navy md:text-2xl">Menunggu konfirmasi transfer</h2>
        {pending.length === 0 ? <p>Tidak ada transfer yang menunggu.</p> : pending.map((p) => (
          <form key={p.paymentId} action={confirmManualAction} className="space-y-2 rounded-2xl border border-line bg-surface p-5">
            <input type="hidden" name="paymentId" value={p.paymentId} />
            <p className="break-words font-semibold text-navy">{KIND[p.kind] ?? p.kind} · {formatIdr(p.amountIdr)} · kode <span className="font-mono">{paymentReference(p.paymentId)}</span></p>
            <p>Dibuat {new Date(p.createdAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB. Cocokkan kode dengan berita transfer sebelum mengonfirmasi.</p>
            {p.expired && <p className="font-semibold">Batas bayar pesanan ini sudah lewat. Konfirmasi hanya bila dana benar-benar masuk; isi waktu dana diterima. Dana yang masuk terlambat akan masuk daftar rekonsiliasi.</p>}
            {!p.expired && p.orderStatus === "PAID" && <p className="font-semibold">Pesanan ini sudah lunas lewat pembayaran lain. Konfirmasi hanya bila dana benar-benar masuk; dana tambahan akan masuk daftar rekonsiliasi untuk dikembalikan.</p>}
            <label className="block"><span className={labelText}>Referensi bank (Wajib)</span><input name="bankRef" required minLength={3} maxLength={64} className={fieldClass} /></label>
            <label className="block"><span className={labelText}>Jumlah yang diterima (Rp)</span><input name="amountIdr" type="number" required min={1} defaultValue={p.amountIdr} className={fieldClass} /></label>
            <label className="block"><span className={labelText}>Waktu dana diterima di bank (WIB, kosongkan bila baru saja)</span><input name="receivedAt" type="datetime-local" className={fieldClass} /></label>
            <button type="submit" className={buttonClass("primary")}>Konfirmasi pembayaran</button>
          </form>
        ))}
      </section>
      <section aria-labelledby="rekon-h" className="space-y-3">
        <h2 id="rekon-h" className="text-xl font-bold text-navy md:text-2xl">Perlu rekonsiliasi</h2>
        {recon.length === 0 ? <p>Tidak ada pesanan yang perlu direkonsiliasi.</p> : (
          <ul className="space-y-3">
            {recon.map((r) => (
              <li key={r.paymentId ?? r.orderId} className="space-y-2 rounded-2xl border border-line bg-surface p-4">
                <p>Pesanan {r.orderId.slice(0, 8)} · {formatIdr(r.amountIdr)} · {new Date(r.createdAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB</p>
                {r.extraPayment && r.status === "CANCELLED" && <p className="font-semibold">Dana masuk pada pesanan yang sudah dibatalkan. Pesanan tetap dibatalkan; dana ini perlu dikembalikan.</p>}
                {r.extraPayment && r.status !== "CANCELLED" && <p className="font-semibold">Pembayaran tambahan pada pesanan yang sudah lunas. Pesanan tetap aktif; dana tambahan ini perlu dikembalikan.</p>}
                <form action={resolveReconciliationAction} className="space-y-2">
                  <input type="hidden" name="orderId" value={r.orderId} />
                  <label className="block"><span className={labelText}>Catatan (Wajib, min. 5 karakter)</span><input name="note" required minLength={5} maxLength={300} className={fieldClass} /></label>
                  <label className="block"><span className={labelText}>Tindakan</span>
                    <select name="action" className={fieldClass}>
                      {!r.extraPayment && <option value="ACTIVATE">Aktifkan pesanan (dana terbukti diterima penuh)</option>}
                      <option value="REFUND_RECORDED">Catat pengembalian dana (dilakukan di luar sistem)</option>
                      {!r.extraPayment && <option value="CLOSE">Tutup tanpa aktivasi</option>}
                    </select>
                  </label>
                  <button type="submit" className={buttonClass("primary")}>Simpan keputusan</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

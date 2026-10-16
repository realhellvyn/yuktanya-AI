import { billingService } from "@/lib/billing/runtime";
import { formatIdr } from "@/lib/pricing/catalog";
import { paymentReference } from "@/lib/reviews/paths";
import { confirmManualAction, resolveReconciliationAction } from "./actions";

export const dynamic = "force-dynamic";
const RESULT: Record<string, string> = {
  SETTLED: "Pembayaran dikonfirmasi dan pesanan diaktifkan.", DUPLICATE: "Pembayaran ini sudah pernah dikonfirmasi.",
  AMOUNT_MISMATCH: "Jumlah tidak sama dengan pesanan. Pesanan ditandai untuk rekonsiliasi.", RECONCILIATION_REQUIRED: "Pesanan kedaluwarsa atau sudah dibayar. Ditandai untuk rekonsiliasi.",
  NOT_FOUND: "Pembayaran tidak ditemukan.",
  ACTIVATED: "Pesanan diaktifkan setelah rekonsiliasi.", REFUND_RECORDED: "Pengembalian dana dicatat. Lakukan transfer pengembalian di luar sistem.", CLOSED: "Pesanan ditutup.",
};
const KIND: Record<string, string> = { MEMBERSHIP_MONTHLY: "Membership 1 periode", MEMBERSHIP_ANNUAL: "Membership 1 tahun", BUNDLE: "Paket kredit", STANDARD_REVIEW: "Pemeriksaan Standar", DEEP_REVIEW: "Deep Review" };

export default async function AdminPaymentsPage({ searchParams }: { searchParams: Promise<{ r?: string; e?: string }> }) {
  const q = await searchParams;
  const svc = billingService();
  const [pending, recon] = await Promise.all([svc.pendingManualPayments(), svc.reconciliation()]);
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-3xl font-semibold">Pembayaran</h1>
      {q.r && <p role="status" className="rounded-lg border border-line bg-white p-3">{RESULT[q.r] ?? q.r}</p>}
      {q.e && <p role="alert" className="font-semibold text-danger">Konfirmasi gagal ({q.e}). Periksa data lalu ulangi.</p>}
      <section aria-labelledby="menunggu-h" className="space-y-3">
        <h2 id="menunggu-h" className="text-2xl font-semibold">Menunggu konfirmasi transfer</h2>
        {pending.length === 0 ? <p>Tidak ada transfer yang menunggu.</p> : pending.map((p) => (
          <form key={p.paymentId} action={confirmManualAction} className="space-y-2 rounded-lg border border-line bg-white p-4">
            <input type="hidden" name="paymentId" value={p.paymentId} />
            <p className="font-semibold">{KIND[p.kind] ?? p.kind} · {formatIdr(p.amountIdr)} · kode <span className="font-mono">{paymentReference(p.paymentId)}</span></p>
            <p>Dibuat {new Date(p.createdAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB. Cocokkan kode dengan berita transfer sebelum mengonfirmasi.</p>
            <label className="block"><span className="font-medium">Referensi bank (Wajib)</span><input name="bankRef" required minLength={3} maxLength={64} className="mt-1 block min-h-12 w-full rounded-lg border border-slate-400 px-3" /></label>
            <label className="block"><span className="font-medium">Jumlah yang diterima (Rp)</span><input name="amountIdr" type="number" required min={1} defaultValue={p.amountIdr} className="mt-1 block min-h-12 w-full rounded-lg border border-slate-400 px-3" /></label>
            <label className="block"><span className="font-medium">Waktu dana diterima di bank (WIB, kosongkan bila baru saja)</span><input name="receivedAt" type="datetime-local" className="mt-1 block min-h-12 w-full rounded-lg border border-slate-400 px-3" /></label>
            <button type="submit" className="min-h-12 rounded-lg bg-brand hover:bg-brand-dark px-5 font-semibold text-white">Konfirmasi pembayaran</button>
          </form>
        ))}
      </section>
      <section aria-labelledby="rekon-h" className="space-y-3">
        <h2 id="rekon-h" className="text-2xl font-semibold">Perlu rekonsiliasi</h2>
        {recon.length === 0 ? <p>Tidak ada pesanan yang perlu direkonsiliasi.</p> : (
          <ul className="space-y-3">
            {recon.map((r) => (
              <li key={r.orderId} className="space-y-2 rounded-lg border border-line bg-white p-3">
                <p>Pesanan {r.orderId.slice(0, 8)} · {formatIdr(r.amountIdr)} · {new Date(r.createdAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB</p>
                <form action={resolveReconciliationAction} className="space-y-2">
                  <input type="hidden" name="orderId" value={r.orderId} />
                  <label className="block"><span className="font-medium">Catatan (Wajib, min. 5 karakter)</span><input name="note" required minLength={5} maxLength={300} className="mt-1 block min-h-12 w-full rounded-lg border border-slate-400 px-3" /></label>
                  <label className="block"><span className="font-medium">Tindakan</span>
                    <select name="action" className="mt-1 block min-h-12 w-full rounded-lg border border-slate-400 px-3">
                      <option value="ACTIVATE">Aktifkan pesanan (dana terbukti diterima penuh)</option>
                      <option value="REFUND_RECORDED">Catat pengembalian dana (dilakukan di luar sistem)</option>
                      <option value="CLOSE">Tutup tanpa aktivasi</option>
                    </select>
                  </label>
                  <button type="submit" className="min-h-12 rounded-lg bg-brand hover:bg-brand-dark px-5 font-semibold text-white">Simpan keputusan</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

import { billingService } from "@/lib/billing/runtime";
import { formatIdr } from "@/lib/pricing/catalog";
import { confirmManualAction } from "./actions";

export const dynamic = "force-dynamic";
const RESULT: Record<string, string> = {
  SETTLED: "Pembayaran dikonfirmasi dan pesanan diaktifkan.", DUPLICATE: "Pembayaran ini sudah pernah dikonfirmasi.",
  AMOUNT_MISMATCH: "Jumlah tidak sama dengan pesanan. Pesanan ditandai untuk rekonsiliasi.", RECONCILIATION_REQUIRED: "Pesanan kedaluwarsa atau sudah dibayar. Ditandai untuk rekonsiliasi.",
  NOT_FOUND: "Pembayaran tidak ditemukan.",
};

export default async function AdminPaymentsPage({ searchParams }: { searchParams: Promise<{ r?: string; e?: string }> }) {
  const q = await searchParams;
  const svc = billingService();
  const [pending, recon] = await Promise.all([svc.pendingManualPayments(), svc.reconciliation()]);
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-3xl font-semibold">Pembayaran</h1>
      {q.r && <p role="status" className="rounded-lg border border-slate-300 bg-white p-3">{RESULT[q.r] ?? q.r}</p>}
      {q.e && <p role="alert" className="font-semibold text-red-800">Konfirmasi gagal ({q.e}). Periksa data lalu ulangi.</p>}
      <section aria-labelledby="menunggu-h" className="space-y-3">
        <h2 id="menunggu-h" className="text-2xl font-semibold">Menunggu konfirmasi transfer</h2>
        {pending.length === 0 ? <p>Tidak ada transfer yang menunggu.</p> : pending.map((p) => (
          <form key={p.paymentId} action={confirmManualAction} className="space-y-2 rounded-lg border border-slate-300 bg-white p-4">
            <input type="hidden" name="paymentId" value={p.paymentId} />
            <p className="font-semibold">{formatIdr(p.amountIdr)} · {new Date(p.createdAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB</p>
            <label className="block"><span className="font-medium">Referensi bank (Wajib)</span><input name="bankRef" required minLength={3} maxLength={64} className="mt-1 block min-h-12 w-full rounded-lg border border-slate-400 px-3" /></label>
            <label className="block"><span className="font-medium">Jumlah yang diterima (Rp)</span><input name="amountIdr" type="number" required min={1} defaultValue={p.amountIdr} className="mt-1 block min-h-12 w-full rounded-lg border border-slate-400 px-3" /></label>
            <button type="submit" className="min-h-12 rounded-lg bg-blue-600 px-5 font-semibold text-white">Konfirmasi pembayaran</button>
          </form>
        ))}
      </section>
      <section aria-labelledby="rekon-h" className="space-y-3">
        <h2 id="rekon-h" className="text-2xl font-semibold">Perlu rekonsiliasi</h2>
        {recon.length === 0 ? <p>Tidak ada pesanan yang perlu direkonsiliasi.</p> : (
          <ul className="space-y-2">{recon.map((r) => <li key={r.orderId} className="rounded-lg border border-slate-300 bg-white p-3">Pesanan {r.orderId.slice(0, 8)} · {formatIdr(r.amountIdr)} · {new Date(r.createdAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB</li>)}</ul>
        )}
      </section>
    </main>
  );
}

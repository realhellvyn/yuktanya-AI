import Link from "next/link";
import { paymentReference } from "@/lib/reviews/paths";

type Payment = { id: string; provider: string; status: string };
type Action = (formData: FormData) => Promise<void>;
type Props = {
  orderId: string;
  payments: Payment[];
  // false = MIDTRANS_SERVER_KEY belum diisi: tampilkan "Pembayaran belum tersedia" (bukan galat).
  midtransAvailable: boolean;
  production: boolean;
  manualText: string | null;
  payAction: Action;
  refreshAction: Action;
  mockSettleAction: Action;
};
const btn = "min-h-12 rounded-lg px-5 font-semibold";
const primary = `${btn} bg-primary hover:bg-primary-hover text-on-primary`;
const secondary = `${btn} border border-border-strong bg-surface`;

// Cara membayar untuk pesanan yang masih menunggu pembayaran. Pengguna hanya melihat Midtrans (Task 21); status lunas
// selalu dari database (diisi webhook atau "Perbarui status" yang bertanya ke API Midtrans), tidak dari parameter URL.
export function PaymentOptions({ orderId, payments, midtransAvailable, production, manualText, payAction, refreshAction, mockSettleAction }: Props) {
  const midtransPending = payments.find((p) => p.provider === "midtrans" && p.status === "PENDING");
  const midtransEnded = !midtransPending && payments.some((p) => p.provider === "midtrans" && (p.status === "FAILED" || p.status === "EXPIRED"));
  // Pembayaran yang ditolak dapat ternyata berhasil di Midtrans: "Perbarui status" tetap tersedia (API status yang memutuskan).
  const midtransFailed = !midtransPending && payments.some((p) => p.provider === "midtrans" && p.status === "FAILED");
  const manualPending = payments.find((p) => p.provider === "manual" && p.status === "PENDING");
  const mockPending = payments.find((p) => p.provider === "mock" && p.status === "PENDING");
  const hidden = (provider: string) => (
    <>
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="provider" value={provider} />
    </>
  );
  return (
    <section className="space-y-4" aria-label="Cara membayar">
      {manualPending && (
        <div className="space-y-2 rounded-lg border border-line bg-surface p-4">
          <h2 className="text-xl font-semibold">Transfer bank (pesanan lama)</h2>
          {manualText ? <p className="whitespace-pre-line">{manualText}</p> : (
            <p>Instruksi transfer belum tersedia. Jangan melakukan transfer sekarang. <Link className="inline-flex min-h-12 items-center underline" href="/bantuan">Lihat halaman Bantuan</Link></p>
          )}
          <p>Tulis kode berikut pada berita transfer: <strong className="font-mono text-xl">{paymentReference(manualPending.id)}</strong></p>
          <p>Bila Anda sudah mentransfer, tim kami mengonfirmasi pembayaran secara manual. Bila belum, Anda dapat membayar dengan Midtrans di bawah ini.</p>
        </div>
      )}

      {midtransAvailable ? (
        <div className="space-y-3 rounded-lg border border-line bg-surface p-4">
          <h2 className="text-xl font-semibold">Pembayaran lewat Midtrans</h2>
          {midtransPending ? (
            <>
              <p>Anda sudah memulai pembayaran di Midtrans. Bila belum selesai, lanjutkan pembayaran. Bila sudah membayar, status di halaman ini berubah setelah Midtrans mengonfirmasi pembayaran Anda.</p>
              <div className="flex flex-wrap gap-3">
                <form action={payAction}>
                  {hidden("midtrans")}
                  <button type="submit" className={primary}>Lanjutkan pembayaran di Midtrans</button>
                </form>
                <form action={refreshAction}>
                  <input type="hidden" name="orderId" value={orderId} />
                  <button type="submit" className={secondary}>Perbarui status</button>
                </form>
              </div>
            </>
          ) : (
            <>
              {midtransEnded && <p>Pembayaran sebelumnya di Midtrans belum berhasil (gagal, dibatalkan, atau melewati batas waktu). Anda dapat mencoba membayar lagi.</p>}
              <p>Anda akan diarahkan ke halaman Midtrans untuk memilih cara bayar, misalnya transfer bank (virtual account) atau dompet digital. Yuktanya tidak menyimpan data kartu Anda.</p>
              <div className="flex flex-wrap gap-3">
                <form action={payAction}>
                  {hidden("midtrans")}
                  <button type="submit" className={primary}>Bayar dengan Midtrans</button>
                </form>
                {midtransFailed && (
                  <form action={refreshAction}>
                    <input type="hidden" name="orderId" value={orderId} />
                    <button type="submit" className={secondary}>Perbarui status</button>
                  </form>
                )}
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-2 rounded-lg border border-line bg-surface p-4">
          <h2 className="text-xl font-semibold">Pembayaran belum tersedia</h2>
          <p>Pembayaran online sedang disiapkan. Jangan melakukan pembayaran ke pihak mana pun untuk pesanan ini. Silakan coba lagi nanti. <Link className="inline-flex min-h-12 items-center underline" href="/bantuan">Lihat halaman Bantuan</Link></p>
        </div>
      )}

      {!production && !mockPending && (
        <form action={payAction}>
          {hidden("mock")}
          <button type="submit" className={secondary}>Pembayaran simulasi (hanya uji)</button>
        </form>
      )}
      {!production && mockPending && (
        <form action={mockSettleAction}>
          <input type="hidden" name="orderId" value={orderId} />
          <input type="hidden" name="paymentId" value={mockPending.id} />
          <button type="submit" className={secondary}>Simulasikan pembayaran berhasil</button>
        </form>
      )}
    </section>
  );
}

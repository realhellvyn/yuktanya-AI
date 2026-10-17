# Spec — Integrasi pembayaran Midtrans (Snap, mode redirect)

Tanggal: 17 Okt 2026. Status: **disetujui pemilik 17 Okt 2026**. Dikerjakan sebagai Task 21 setelah Task 19–20.

## Keputusan pemilik
- Akun Midtrans Production sudah ada. Urutan: server palsu di tes → Sandbox (kunci sandbox dari dashboard yang sama) → Production.
- Pengguna hanya melihat Midtrans. Opsi transfer manual dihapus dari tampilan pengguna; kode manual dan data lama tetap ada (admin masih bisa melihat/menyelesaikan pembayaran manual lama).
- Refund manual: admin melakukan refund di dashboard Midtrans lalu mencatatnya di admin Yuktanya.

## Arsitektur
- Adaptor ketiga `midtrans` di `src/lib/billing/adapters.ts` (pola sama dengan `mock`/`manual`). Pelunasan tetap lewat fungsi DB `settle_payment` yang sudah idempoten dan memeriksa jumlah; harga, kuota, hak Legal Review, dan diskon tidak berubah.
- `createCharge`: `POST {snapBase}/snap/v1/transactions` (Basic auth server key) dengan `transaction_details.order_id` = `provider_ref` acak (`ytk-<uuid>`, ≤50 karakter) dan `gross_amount` = jumlah dari server; `item_details` satu baris (nama layanan); `callbacks.finish` = `https://<APP_URL>/checkout/<orderId>`; `expiry` mengikuti batas pesanan. Data pribadi minimum: tanpa nama/alamat; email hanya bila diperlukan Midtrans.
- Checkout: tombol "Bayar dengan Midtrans" → server membuat charge → redirect ke `redirect_url` Midtrans (tanpa skrip Snap di halaman kita; CSP tidak dilonggarkan untuk skrip). Halaman kembali `/checkout/<orderId>` tidak pernah menganggap lunas dari parameter URL; hanya status dari DB (diisi webhook) yang dipakai, dengan tombol "Perbarui status".
- Webhook `POST /api/payments/webhook/midtrans`:
  1. Verifikasi `signature_key == SHA512(order_id + status_code + gross_amount + SERVER_KEY)` (perbandingan waktu-konstan); gagal → 401.
  2. Konfirmasi ulang ke `GET {apiBase}/v2/<order_id>/status` dengan server key; status dari API ini yang dipakai (notifikasi palsu dengan tanda tangan bocor pun tidak bisa melunasi tanpa transaksi nyata).
  3. Pemetaan: `settlement`, atau `capture` + `fraud_status=accept` → `settle_payment('midtrans', order_id, '<transaction_id>:<status>', gross_amount, 0, now)`; `pending` → catat event saja; `expire`/`cancel`/`deny`/`failure` → pembayaran GAGAL, pesanan dapat dibayar ulang (fungsi DB baru bila belum ada). Jumlah harus sama persis dengan pembayaran; beda → tidak dilunasi, masuk rekonsiliasi admin.
  4. Idempoten (notifikasi ganda/retry tidak dobel). Balas 200 setelah diproses atau bila sudah diproses; 5xx hanya untuk galat sementara agar Midtrans mengulang.
- Env (Vercel, Sensitive): `MIDTRANS_SERVER_KEY`; plain: `MIDTRANS_ENV=sandbox|production` (menentukan base URL). Tanpa kunci → tombol bayar menampilkan "Pembayaran belum tersedia", bukan galat.
- Migrasi 39: izinkan provider `midtrans` di `payments` (+ varian staging tanpa literal DROP), fungsi gagal-bayar bila belum ada, REVOKE/GRANT service_role seperti pola lama.

## Keamanan dan kebenaran
- Server key tidak pernah ke klien atau log. Body webhook tidak pernah dipakai untuk jumlah/status tanpa konfirmasi API.
- Callback pembayaran tidak memberi persetujuan profesional apa pun (aturan v8 tetap).
- Rate limit dan ukuran body webhook dibatasi.

## Pengujian
- Unit: tanda tangan benar/salah, pemetaan status, beda jumlah, replay, notifikasi palsu ditolak oleh cek API, kunci kosong.
- DB: constraint provider, idempotensi settle/fail.
- E2E: server Midtrans palsu (Snap create + halaman bayar simulasi yang mengirim webhook bertanda tangan) untuk Legal Review dan Deep Review, termasuk expire → bayar ulang; mode produksi (`test:e2e:prod`).
- Live: setelah deploy, uji Sandbox di yuktanya.com dengan simulator Midtrans; baru kemudian kunci Production.

## Langkah pemilik (tidak bisa gue lakukan)
1. Isi `MIDTRANS_SERVER_KEY` (Sandbox dulu) sebagai Sensitive dan `MIDTRANS_ENV=sandbox` di Vercel.
2. Dashboard Midtrans → Settings → Payment Notification URL: `https://yuktanya.com/api/payments/webhook/midtrans`; aktifkan metode bayar yang diinginkan.
3. Setelah uji Sandbox lolos: ganti ke kunci Production dan `MIDTRANS_ENV=production`, ulangi URL notifikasi di mode Production.

## Di luar cakupan
Refund via API, Snap popup, Core API, simpan kartu, langganan otomatis Membership berulang (pembayaran Membership tetap per periode lewat alur pesanan yang ada).

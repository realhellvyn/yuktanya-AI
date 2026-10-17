// Ditampilkan sementara Beranda dimuat (beberapa kueri database). Sengaja hanya di segmen ini: loading.tsx membuat respons
// mengalir lebih dulu, sehingga notFound() di halaman bersarang (dokumen/review milik orang lain) tidak lagi berstatus 404.
export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="flex min-h-[40vh] items-center justify-center gap-3 text-lg text-muted">
      <span aria-hidden="true" className="h-6 w-6 animate-spin rounded-full border-4 border-line border-t-primary motion-reduce:animate-none" />
      Memuat…
    </div>
  );
}

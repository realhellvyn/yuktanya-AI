import Link from "next/link";

// Isi bersama halaman galat. Pesan galat dan jejak tumpukan tidak pernah ditampilkan; hanya kode rujukan pendek (digest)
// yang dapat disebutkan ke tim bila diminta.
export function ErrorView({ digest, onRetry }: { digest?: string; onRetry: () => void }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-5 px-4 py-12">
      <h1 className="text-[1.75rem] font-bold leading-tight text-navy md:text-4xl">Terjadi kendala</h1>
      <p className="text-lg">Halaman ini gagal dimuat. Data Anda tetap aman. Silakan coba lagi atau kembali ke Beranda.</p>
      {digest && /^[A-Za-z0-9]{1,32}$/.test(digest) && <p className="text-muted">Kode rujukan: <span className="font-mono">{digest}</span></p>}
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={onRetry} className="inline-flex min-h-[52px] items-center justify-center rounded-xl bg-primary px-6 font-semibold text-on-primary hover:bg-primary-hover">Coba lagi</button>
        <Link href="/" className="inline-flex min-h-12 items-center justify-center rounded-xl border border-border-strong bg-surface px-6 font-semibold text-ink hover:bg-subtle">Kembali ke Beranda</Link>
        <Link href="/bantuan" className="inline-flex min-h-12 items-center justify-center rounded-xl px-3 font-semibold text-link underline">Bantuan</Link>
      </div>
    </main>
  );
}

import Link from "next/link";

export const metadata = { title: "Halaman tidak ditemukan | Yuktanya" };

// 404 untuk seluruh aplikasi (rute tak dikenal dan notFound()). Bahasa Indonesia sederhana, dengan jalan kembali.
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-5 px-4 py-12">
      <Link href="/" className="inline-flex min-h-12 items-center text-2xl font-bold tracking-tight text-navy">Yuktanya</Link>
      <h1 className="text-[1.75rem] font-bold leading-tight text-navy md:text-4xl">Halaman tidak ditemukan</h1>
      <p className="text-lg">Alamat yang Anda buka tidak ada, sudah dipindahkan, atau bukan milik akun Anda. Periksa kembali tautannya.</p>
      <div className="flex flex-wrap gap-3">
        <Link href="/" className="inline-flex min-h-[52px] items-center justify-center rounded-xl bg-brand px-6 font-semibold text-white hover:bg-brand-dark">Ke Beranda</Link>
        <Link href="/bantuan" className="inline-flex min-h-12 items-center justify-center rounded-xl border border-slate-400 bg-white px-6 font-semibold text-ink hover:bg-slate-50">Buka Bantuan</Link>
      </div>
    </main>
  );
}

import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";

export const metadata = { title: "Halaman tidak ditemukan | Yuktanya" };

// 404 untuk seluruh aplikasi (rute tak dikenal dan notFound()). Bahasa Indonesia sederhana, dengan jalan kembali.
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-5 px-4 py-12">
      <BrandLogo href="/" className="self-start" />
      <h1 className="text-[1.75rem] font-bold leading-tight text-navy md:text-4xl">Halaman tidak ditemukan</h1>
      <p className="text-lg">Alamat yang Anda buka tidak ada, sudah dipindahkan, atau bukan milik akun Anda. Periksa kembali tautannya.</p>
      <div className="flex flex-wrap gap-3">
        <Link href="/" className="inline-flex min-h-[52px] items-center justify-center rounded-xl bg-primary px-6 font-semibold text-on-primary hover:bg-primary-hover">Ke Beranda</Link>
        <Link href="/bantuan" className="inline-flex min-h-12 items-center justify-center rounded-xl border border-border-strong bg-surface px-6 font-semibold text-ink hover:bg-subtle">Buka Bantuan</Link>
      </div>
    </main>
  );
}

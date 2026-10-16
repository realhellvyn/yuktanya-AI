import Link from "next/link";

export default function AdminPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-4 p-6">
      <h1 className="text-3xl font-semibold">Dashboard Admin Platform</h1>
      <p>Ringkasan operasional akan tampil di sini. Data belum tersedia.</p>
      <ul className="space-y-1">
        <li><Link className="inline-flex min-h-12 items-center underline" href="/admin/payments">Pembayaran</Link></li>
        <li><Link className="inline-flex min-h-12 items-center underline" href="/admin/routing">Perutean review</Link></li>
        <li><Link className="inline-flex min-h-12 items-center underline" href="/admin/rubric">Persetujuan rubrik Enhanced</Link></li>
        <li><Link className="inline-flex min-h-12 items-center underline" href="/admin/features">Kunci fitur per plan</Link></li>
      </ul>
    </main>
  );
}

import Link from "next/link";
import { documentsService } from "@/lib/documents/runtime";
import { requireUserId } from "@/lib/documents/session";

// Halaman memakai sesi dan DB: tidak boleh diprarender saat build.
export const dynamic = "force-dynamic";

export default async function DocumentsPage() {
  const userId = await requireUserId();
  const docs = await documentsService().list(userId);
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-3xl font-semibold">Dokumen Saya</h1>
      {docs.length === 0 ? (
        <p>Belum ada dokumen. Mulai dari membuat dokumen pertama Anda. <Link className="text-blue-700 underline" href="/workspace/new">Buat Dokumen</Link></p>
      ) : (
        <ul className="space-y-3">
          {docs.map((d) => (
            <li key={d.id} className="rounded-lg border border-slate-300 bg-white p-4">
              <p className="font-semibold">{d.title}</p>
              <p>{d.versionCount === 0 ? "Draf belum selesai" : `${d.versionCount} versi dibuat`}</p>
              <Link className="text-blue-700 underline" href={d.versionCount === 0 ? `/workspace/${d.id}` : `/documents/${d.id}`}>{d.versionCount === 0 ? "Lanjutkan mengisi" : "Buka"}</Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

import Link from "next/link";
import { documentsService } from "@/lib/documents/runtime";
import { requireUserId } from "@/lib/documents/session";

export default async function VaultPage() {
  const userId = await requireUserId();
  const svc = documentsService();
  const docs = (await svc.list(userId)).filter((d) => d.versionCount > 0);
  const detailed = await Promise.all(docs.map((d) => svc.get(userId, d.id)));
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-3xl font-semibold">Vault</h1>
      <p>Vault menyimpan versi dokumen yang sudah dibuat dan tidak dapat diubah. Dokumen yang masih diisi ada di Dokumen Saya.</p>
      {detailed.length === 0 ? <p>Belum ada versi yang tersimpan.</p> : (
        <ul className="space-y-4">
          {detailed.filter((d) => d !== null).map((d) => (
            <li key={d.id} className="rounded-lg border border-slate-300 bg-white p-4">
              <p className="font-semibold">{d.title}</p>
              <ul className="mt-2 space-y-1">
                {d.versions.map((v) => (
                  <li key={v.id}>
                    <Link className="text-blue-700 underline" href={`/documents/${d.id}?version=${v.id}`}>Versi {v.versionNo}</Link>
                    {" "}· kode <span className="font-mono">{v.sha256.slice(0, 12)}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

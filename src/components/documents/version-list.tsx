import type { VersionSummary } from "@/lib/documents/service";

const when = (iso: string) => new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(iso));

export function VersionList({ versions, documentId }: { versions: VersionSummary[]; documentId: string }) {
  return (
    <ul className="space-y-3">
      {versions.map((v, i) => (
        <li key={v.id} className="rounded-lg border border-slate-300 bg-white p-4">
          <p className="font-semibold">Versi {v.versionNo}</p>
          <p>Dibuat {when(v.createdAt)} WIB</p>
          <p>Kode versi: <span className="font-mono">{v.sha256.slice(0, 12)}</span></p>
          <p>Versi baru belum diperiksa</p>
          <p className="mt-2 flex flex-wrap gap-4">
            <a className="inline-flex min-h-12 items-center text-blue-700 underline" href={`/documents/${documentId}?version=${v.id}`}>Lihat</a>
            {i > 0 && <a className="inline-flex min-h-12 items-center text-blue-700 underline" href={`/documents/${documentId}?version=${v.id}&against=${versions[i - 1].id}`}>Bandingkan dengan versi sebelumnya</a>}
          </p>
        </li>
      ))}
    </ul>
  );
}

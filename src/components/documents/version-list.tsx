import { StatusBadge } from "@/components/ui/status-badge";
import type { VersionSummary } from "@/lib/documents/service";
import { versionStatusText, wasReviewed, type VersionReviewState } from "@/lib/documents/version-status";

const when = (iso: string) => new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(iso));

// Status per versi berasal dari database (permintaan pemeriksaan dan verifikasi versi itu sendiri), bukan label tetap.
export function VersionList({ versions, documentId, statuses = {} }: { versions: VersionSummary[]; documentId: string; statuses?: Record<string, VersionReviewState> }) {
  return (
    <ul className="space-y-3">
      {versions.map((v, i) => {
        const earlierReviewed = versions.slice(0, i).some((p) => wasReviewed(statuses[p.id]));
        const s = versionStatusText(statuses[v.id], earlierReviewed);
        return (
          <li key={v.id} className="space-y-1 rounded-xl border border-line bg-white p-4">
            <p className="font-semibold">Versi {v.versionNo}</p>
            <p>Dibuat {when(v.createdAt)} WIB</p>
            <p>Kode versi: <span className="font-mono">{v.sha256.slice(0, 12)}</span></p>
            <p><StatusBadge tone={s.tone}>{s.text}</StatusBadge></p>
            <p className="mt-2 flex flex-wrap gap-4">
              <a className="inline-flex min-h-12 items-center text-brand-dark underline" href={`/documents/${documentId}?version=${v.id}`}>Lihat versi {v.versionNo}</a>
              {i > 0 && <a className="inline-flex min-h-12 items-center text-brand-dark underline" href={`/documents/${documentId}?version=${v.id}&against=${versions[i - 1].id}`}>Bandingkan dengan versi sebelumnya</a>}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

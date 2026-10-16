import { ButtonLink } from "@/components/ui/button";
import { Card, EmptyState, PageHeading } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDateId, wibDate } from "@/lib/documents/format";
import { documentsService } from "@/lib/documents/runtime";
import { requireUserId } from "@/lib/documents/session";
import { flags } from "@/lib/flags";

export const metadata = { title: "Dokumen Saya | Yuktanya" };

// Halaman memakai sesi dan DB: tidak boleh diprarender saat build.
export const dynamic = "force-dynamic";

export default async function DocumentsPage() {
  const userId = await requireUserId();
  const docs = await documentsService().list(userId);
  return (
    <main className="max-w-3xl space-y-6">
      <PageHeading
        title="Dokumen Saya"
        actions={
          <div className="flex flex-wrap gap-3">
            {docs.length > 0 && <ButtonLink href="/workspace/new">Buat dokumen baru</ButtonLink>}
            {flags.aiPreReview && <ButtonLink href="/documents/upload" variant="secondary">Periksa dokumen</ButtonLink>}
          </div>
        }
      />
      {docs.length === 0 ? (
        <EmptyState title="Belum ada dokumen" text="Mulai dari membuat dokumen pertama Anda." action={<ButtonLink href="/workspace/new">Buat Dokumen</ButtonLink>} />
      ) : (
        <ul className="space-y-3">
          {docs.map((d) => (
            <li key={d.id}>
              <Card className="flex flex-wrap items-center justify-between gap-4 !p-4 md:!p-5">
                <div className="min-w-0 space-y-1">
                  <p className="text-lg font-bold text-navy">{d.title}</p>
                  <p className="text-sm text-muted">Dibuat {formatDateId(wibDate(d.createdAt))}{d.versionCount > 0 ? ` · ${d.versionCount} versi` : ""}</p>
                  {d.category === "UPLOAD" ? <StatusBadge tone="info">Dokumen unggahan</StatusBadge> : d.versionCount === 0 ? <StatusBadge tone="warning">Draf belum selesai</StatusBadge> : <StatusBadge tone="info">Dokumen sudah dibuat</StatusBadge>}
                </div>
                <ButtonLink href={d.versionCount === 0 ? `/workspace/${d.id}` : `/documents/${d.id}`} variant={d.versionCount === 0 ? "primary" : "secondary"}>{d.versionCount === 0 ? "Lanjutkan mengisi" : "Buka"}</ButtonLink>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

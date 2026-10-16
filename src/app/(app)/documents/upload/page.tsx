import { randomUUID } from "node:crypto";
import { UploadForm } from "@/components/ai-review/upload-form";
import { ButtonLink } from "@/components/ui/button";
import { Card, PageHeading } from "@/components/ui/card";
import { createPgUsageStore } from "@/lib/ai/quota";
import { AI_PREREVIEW_LABEL } from "@/lib/copy";
import { getPool } from "@/lib/db";
import { requireUserId } from "@/lib/documents/session";
import { flags } from "@/lib/flags";
import { UPLOAD_LIMITS } from "@/lib/uploads/limits";
import { uploadAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Periksa Dokumen | Yuktanya" };

const TITLE = "Periksa dokumen yang sudah Anda punya";

export default async function UploadPage() {
  const userId = await requireUserId();
  if (!flags.aiPreReview) {
    return (
      <main className="max-w-3xl space-y-6">
        <PageHeading title={TITLE} />
        <Card className="space-y-3 border-amber-300 bg-amber-50/60">
          <p className="text-lg font-semibold text-navy">Fitur sedang disiapkan</p>
          <p>Analisis awal AI untuk dokumen yang Anda unggah belum tersedia. Tidak ada berkas yang disimpan atau dikirim ke AI dari halaman ini.</p>
          <div className="flex flex-wrap gap-3">
            <ButtonLink href="/workspace/new">Buat dokumen baru</ButtonLink>
            <ButtonLink href="/cases/new" variant="secondary">Ajukan penilaian khusus</ButtonLink>
          </div>
        </Card>
      </main>
    );
  }
  const usage = await createPgUsageStore(getPool()).snapshot(userId);
  const limits = UPLOAD_LIMITS[usage.plan];
  const reset = new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(usage.resetAt));
  return (
    <main className="max-w-3xl space-y-6">
      <PageHeading title={TITLE} lead="Unggah dokumen perjanjian Anda. AI akan menandai hal yang perlu diperhatikan sebelum Anda bertanya ke pengacara." />
      <Card className="space-y-3">
        <h2 className="text-xl font-bold text-navy">Berkas yang dapat diperiksa</h2>
        <ul className="list-disc space-y-1 pl-6">
          <li>PDF yang teksnya bisa dipilih (bukan hasil pindai/foto), Word (DOCX), atau teks (TXT).</li>
          <li>Ukuran paling besar 5 MB, paling banyak {limits.maxPages} halaman{usage.plan === "FREE" ? " (Member: 20 halaman)" : ""}.</li>
          <li>Setiap unggahan menjadi satu dokumen baru yang tidak dapat diubah. Isi berkas asli disimpan privat di akun Anda.</li>
        </ul>
        <h2 className="pt-2 text-xl font-bold text-navy">Sisa jatah hari ini</h2>
        <ul className="space-y-1">
          <li>Dokumen baru: <strong>{usage.documentsRemaining} dari {usage.documentLimit}</strong></li>
          <li>Analisis AI: <strong>{usage.aiReviewsRemaining} dari {usage.aiReviewLimit}</strong> (setiap analisis juga memakai 1 pesan AI; sisa pesan {usage.messagesRemaining})</li>
        </ul>
        <p className="text-sm text-muted">Jatah dihitung ulang pukul 00.00 WIB ({reset} WIB). Analisis yang gagal tidak memakai jatah.</p>
      </Card>
      <Card className="space-y-4">
        <h2 className="text-xl font-bold text-navy">Privasi</h2>
        <p>Hanya teks hasil pembacaan berkas yang dikirim ke AI, dan hanya setelah Anda mencentang persetujuan di bawah. Selama masa uji coba, gunakan dokumen contoh tanpa data pribadi asli.</p>
        <p className="font-semibold text-amber-900">{AI_PREREVIEW_LABEL} Hasil AI bukan pemeriksaan pengacara.</p>
        {usage.documentsRemaining <= 0 ? (
          <p role="status" className="rounded-xl border border-amber-400 bg-amber-50 p-4 font-semibold text-amber-900">
            Batas dokumen baru hari ini sudah tercapai. Coba lagi setelah pukul 00.00 WIB.
          </p>
        ) : (
          <UploadForm action={uploadAction} idempotencyKey={randomUUID()} />
        )}
      </Card>
      <div className="flex flex-wrap items-center gap-x-2 text-muted">
        <span>Dokumen Anda rumit atau berisiko tinggi?</span>
        <ButtonLink href="/cases/new" variant="quiet" className="!px-0">Ajukan penilaian khusus</ButtonLink>
      </div>
    </main>
  );
}

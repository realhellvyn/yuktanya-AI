import { notFound } from "next/navigation";
import { ButtonLink } from "@/components/ui/button";
import { Card, EmptyState, PageHeading } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { casesService } from "@/lib/cases/runtime";
import { CASE_STATUS_LABEL, CASE_STATUS_TONE, formatWib } from "@/lib/cases/view";
import { categoryLabel } from "@/lib/partner/labels";
import { getSessionRoles } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Special Legal Case | Mitra Hukum Yuktanya" };

// Khusus koordinator (juga dijaga proxy). Daftar hanya memuat kasus firma tempat akun ini menjadi koordinator.
export default async function PartnerCasesPage() {
  const s = (await getSessionRoles())!;
  if (!s.roles.includes("partner_admin")) notFound();
  const rows = await casesService().partnerList(s.userId);
  return (
    <main className="max-w-4xl space-y-6">
      <PageHeading title="Special Legal Case" lead="Pengajuan Kasus Hukum Khusus (Special Legal Case) untuk firma Anda. Periksa konflik kepentingan, nilai kebutuhan, lalu kirim penawaran." />
      {rows.length === 0 ? (
        <EmptyState title="Belum ada Special Legal Case" text="Pengajuan baru dari pemilik dokumen akan tampil di sini." />
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.id}>
              <Card className="flex flex-wrap items-center justify-between gap-3 !p-4">
                <div className="min-w-0 space-y-1.5">
                  <p className="break-words text-lg font-bold text-navy">{r.category ? categoryLabel(r.category) : "Tanpa dokumen terkait"}</p>
                  <p className="text-muted">Masuk {formatWib(r.createdAt)} · {r.firmName}</p>
                  <StatusBadge tone={CASE_STATUS_TONE[r.status]}>{CASE_STATUS_LABEL[r.status]}</StatusBadge>
                </div>
                <ButtonLink href={`/partner/cases/${r.id}`} variant="secondary">Buka</ButtonLink>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

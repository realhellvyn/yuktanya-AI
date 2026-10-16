import { notFound } from "next/navigation";
import { ButtonLink } from "@/components/ui/button";
import { Card, EmptyState, PageHeading } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDateId } from "@/lib/documents/format";
import { partnerService } from "@/lib/partner/runtime";
import { getSessionRoles } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tim Firma — Penugasan Review Standar & Pemeriksaan Mendalam | Mitra Hukum Yuktanya" };
const CAPACITY = 10;

function authStatus(m: { authorized: boolean; authorization: { validFrom: string; validTo: string; revoked: boolean } | null }) {
  if (m.authorized && m.authorization) return { tone: "success" as const, text: "Otorisasi aktif", detail: `Berlaku ${formatDateId(m.authorization.validFrom)} s/d ${formatDateId(m.authorization.validTo)}` };
  if (!m.authorization) return { tone: "danger" as const, text: "Belum berotorisasi", detail: "Belum dapat ditugaskan. Hubungi admin platform." };
  if (m.authorization.revoked) return { tone: "danger" as const, text: "Otorisasi dicabut", detail: "Tidak dapat ditugaskan. Pindahkan pekerjaannya." };
  return { tone: "warning" as const, text: "Otorisasi tidak berlaku", detail: `Masa berlaku ${formatDateId(m.authorization.validFrom)} s/d ${formatDateId(m.authorization.validTo)}` };
}

// Khusus koordinator (juga dijaga proxy). Hanya membaca; penambahan anggota dan otorisasi tetap di tangan admin platform.
export default async function TeamPage() {
  const s = (await getSessionRoles())!;
  if (!s.roles.includes("partner_admin")) notFound();
  const team = await partnerService().team(s.userId);
  const firms = [...new Map(team.map((m) => [m.firmId, m.firmName])).entries()];
  return (
    <main className="max-w-4xl space-y-8">
      <PageHeading title="Tim firma" lead="Reviewer di firma Anda, beban kerja aktif, dan masa berlaku otorisasi profesional."
        actions={<ButtonLink href="/partner#penugasan">Tugaskan permintaan</ButtonLink>} />
      <p className="rounded-xl border border-line bg-white p-4">Koordinator menugaskan pekerjaan, tetapi tidak memberi peran atau otorisasi. Penambahan anggota dan otorisasi profesional dilakukan oleh admin platform setelah verifikasi.</p>
      {firms.length === 0 && <EmptyState title="Belum ada reviewer" text="Belum ada reviewer di firma Anda. Minta admin platform menambahkan reviewer." />}
      {firms.map(([firmId, firmName]) => (
        <section key={firmId} aria-label={firmName} className="space-y-3">
          <h2 className="break-words text-xl font-bold text-navy md:text-2xl">{firmName}</h2>
          <ul className="space-y-3">
            {team.filter((m) => m.firmId === firmId).map((m) => {
              const a = authStatus(m);
              const total = m.activeStandard + m.activeDeep;
              return (
                <li key={m.reviewerId}>
                  <Card className="space-y-2">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <p className="min-w-0 break-all text-lg font-semibold text-navy">{m.email}</p>
                      <StatusBadge tone={a.tone}>{a.text}</StatusBadge>
                    </div>
                    <p className="text-muted">{a.detail}</p>
                    <p>Pekerjaan aktif: <strong>{total}</strong> dari batas {CAPACITY} ({m.activeStandard} Review Standar, {m.activeDeep} Pemeriksaan Mendalam){total >= CAPACITY ? " — penuh" : ""}</p>
                  </Card>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </main>
  );
}

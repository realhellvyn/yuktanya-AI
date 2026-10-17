import { notFound } from "next/navigation";
import { ButtonLink } from "@/components/ui/button";
import { Card, EmptyState, PageHeading } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { categoryLabel } from "@/lib/partner/labels";
import { partnerService } from "@/lib/partner/runtime";
import type { ApprovalItem } from "@/lib/partner/service";
import { getSessionRoles } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Siap diputuskan: Legal Review dan Deep Review | Mitra Hukum Yuktanya" };
const KIND = { STANDARD: "Legal Review", DEEP: "Deep Review" } as const;

// Daftar keputusan akhir milik reviewer yang masuk. Tidak ada tombol bayar-untuk-menyetujui; keputusan hanya dibuat di editor.
function Item({ i }: { i: ApprovalItem }) {
  return (
    <li>
      <Card className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-semibold uppercase tracking-wide text-muted">{KIND[i.kind]} · {categoryLabel(i.category)}</p>
            <p className="break-words text-lg font-bold text-navy">{i.title}, versi {i.versionNo}</p>
          </div>
          <StatusBadge tone={i.ready ? "success" : "warning"}>{i.ready ? "Siap diputuskan" : "Belum siap"}</StatusBadge>
        </div>
        {!i.ready && (
          <div>
            <p className="font-semibold">Yang masih perlu dilengkapi:</p>
            <ul className="mt-1 list-disc space-y-1 pl-6">{i.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          </div>
        )}
        <ButtonLink href={i.href} variant={i.ready ? "primary" : "secondary"}>{i.ready ? "Buka dan putuskan" : "Buka untuk melengkapi"}</ButtonLink>
      </Card>
    </li>
  );
}

export default async function ApprovalsPage() {
  const s = (await getSessionRoles())!;
  if (!s.roles.includes("reviewer")) notFound();
  const items = await partnerService().approvals(s.userId);
  const ready = items.filter((i) => i.ready);
  const waiting = items.filter((i) => !i.ready);
  return (
    <main className="max-w-4xl space-y-8">
      <PageHeading title="Siap diputuskan" lead="Legal Review dan Deep Review yang ditugaskan kepada Anda. Keputusan akhir selalu Anda buat sendiri di editor; pembayaran tidak pernah menyetujui hasil." />
      {items.length === 0 && <EmptyState title="Tidak ada pekerjaan aktif" text="Belum ada pekerjaan yang ditugaskan kepada Anda." action={<ButtonLink href="/partner" variant="secondary">Kembali ke antrean</ButtonLink>} />}
      {ready.length > 0 && (
        <section aria-labelledby="siap-h" className="space-y-3">
          <h2 id="siap-h" className="text-xl font-bold text-navy md:text-2xl">Siap diputuskan ({ready.length})</h2>
          <ul className="space-y-3">{ready.map((i) => <Item key={i.id} i={i} />)}</ul>
        </section>
      )}
      {waiting.length > 0 && (
        <section aria-labelledby="belum-h" className="space-y-3">
          <h2 id="belum-h" className="text-xl font-bold text-navy md:text-2xl">Belum siap ({waiting.length})</h2>
          <ul className="space-y-3">{waiting.map((i) => <Item key={i.id} i={i} />)}</ul>
        </section>
      )}
    </main>
  );
}

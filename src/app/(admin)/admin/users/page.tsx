import { PageHeading } from "@/components/ui/card";
import { KpiCard } from "@/components/admin/kpi-card";
import { RangeNav } from "@/components/admin/range-nav";
import { fmtCount } from "@/lib/admin/format";
import { loadOverview } from "@/lib/admin/page-data";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pengguna | Admin Yuktanya" };

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ r?: string }> }) {
  const { o, range } = await loadOverview(await searchParams);
  return (
    <main className="max-w-5xl space-y-6">
      <PageHeading title="Pengguna" />
      <RangeNav path="/admin/users" range={range} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard label="Terdaftar (total)" value={fmtCount(o.users.registered)} />
        <KpiCard label="Baru pada rentang" value={fmtCount(o.users.new)} />
        <KpiCard label="Teraktivasi" value={fmtCount(o.users.activated)} hint="Pengguna yang membuat versi dokumen pada rentang" />
      </div>
    </main>
  );
}

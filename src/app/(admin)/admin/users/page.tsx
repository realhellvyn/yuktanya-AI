import { KpiCard } from "@/components/admin/kpi-card";
import { RangeNav } from "@/components/admin/range-nav";
import { fmtCount } from "@/lib/admin/format";
import { loadOverview } from "@/lib/admin/page-data";

export const dynamic = "force-dynamic";

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ r?: string }> }) {
  const { o, range } = await loadOverview(await searchParams);
  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <h1 className="text-3xl font-semibold">Pengguna</h1>
      <RangeNav path="/admin/users" range={range} />
      <div className="grid gap-4 md:grid-cols-3">
        <KpiCard label="Terdaftar (total)" value={fmtCount(o.users.registered)} />
        <KpiCard label="Baru pada rentang" value={fmtCount(o.users.new)} />
        <KpiCard label="Teraktivasi" value={fmtCount(o.users.activated)} hint="Pengguna yang membuat versi dokumen pada rentang" />
      </div>
    </main>
  );
}

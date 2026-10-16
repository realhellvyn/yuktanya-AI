import { buttonClass } from "@/components/ui/button";
import { PageHeading } from "@/components/ui/card";
import { getPool } from "@/lib/db";
import { setFeatureAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Kunci fitur per plan | Admin Yuktanya" };

const FEATURES = [
  { key: "vault.share", label: "Berbagi ke pihak lawan" },
  { key: "vault.reminders", label: "Pengingat tenggat" },
  { key: "vault.evidence_pack", label: "Paket bukti" },
];
const PLANS = ["FREE", "MEMBER"] as const;

export default async function FeaturesPage() {
  const { rows } = await getPool().query("select feature_key, plan from feature_plan_map");
  const on = new Set(rows.map((r) => `${r.feature_key}:${r.plan}`));
  return (
    <main className="max-w-5xl space-y-6">
      <PageHeading title="Pemetaan fitur Vault" />
      <p>Pengaturan awal untuk fitur Vault hanya usulan dan dapat diubah di sini. Setiap perubahan tercatat di audit.</p>
      <ul className="space-y-3">
        {FEATURES.map((f) => (
          <li key={f.key} className="space-y-3 rounded-2xl border border-line bg-white p-5">
            <p className="text-lg font-bold text-navy">{f.label}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {PLANS.map((p) => {
                const active = on.has(`${f.key}:${p}`);
                return (
                  <form key={p} action={setFeatureAction} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 p-3">
                    <input type="hidden" name="feature" value={f.key} />
                    <input type="hidden" name="plan" value={p} />
                    <input type="hidden" name="enabled" value={String(!active)} />
                    <span className="font-semibold">{p === "FREE" ? "Gratis" : "Member"}: {active ? "aktif" : "mati"}</span>
                    <button type="submit" className={buttonClass("secondary")}>{active ? "Matikan" : "Aktifkan"}</button>
                  </form>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}

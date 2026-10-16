import { getPool } from "@/lib/db";
import { setFeatureAction } from "./actions";

export const dynamic = "force-dynamic";

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
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-3xl font-semibold">Pemetaan fitur Vault</h1>
      <p>Pengaturan awal untuk fitur Vault hanya usulan dan dapat diubah di sini. Setiap perubahan tercatat di audit.</p>
      <table className="w-full border-collapse">
        <thead><tr className="border-b border-line text-left"><th className="py-2">Fitur</th>{PLANS.map((p) => <th key={p} className="py-2">{p === "FREE" ? "Gratis" : "Member"}</th>)}</tr></thead>
        <tbody>
          {FEATURES.map((f) => (
            <tr key={f.key} className="border-b border-slate-200">
              <th scope="row" className="py-3 text-left font-normal">{f.label}</th>
              {PLANS.map((p) => {
                const active = on.has(`${f.key}:${p}`);
                return (
                  <td key={p} className="py-3">
                    <form action={setFeatureAction}>
                      <input type="hidden" name="feature" value={f.key} />
                      <input type="hidden" name="plan" value={p} />
                      <input type="hidden" name="enabled" value={String(!active)} />
                      <button type="submit" className="min-h-12 rounded-lg border border-slate-400 bg-white px-4 font-medium">{active ? "Aktif. Matikan" : "Mati. Aktifkan"}</button>
                    </form>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

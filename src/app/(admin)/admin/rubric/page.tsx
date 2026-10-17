import { PageHeading } from "@/components/ui/card";
import { fieldClass, labelText } from "@/components/ui/field";
import { buttonClass } from "@/components/ui/button";
import { getPool } from "@/lib/db";
import { flags } from "@/lib/flags";
import { RUBRIC_VERSION } from "@/lib/deep/rubric";
import { approveRubricAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Persetujuan rubrik Enhanced | Admin Yuktanya" };

// Admin hanya mencatat bahwa mitra hukum sudah menyetujui rubrik (referensi wajib). Admin tidak menilai isi hukum.
export default async function RubricPage({ searchParams }: { searchParams: Promise<{ e?: string; ok?: string }> }) {
  const q = await searchParams;
  const row = (await getPool().query("select signoff_ref, approved_at from rubric_approvals where policy_version = $1", [RUBRIC_VERSION])).rows[0];
  return (
    <main className="max-w-5xl space-y-6">
      <PageHeading title="Persetujuan rubrik Enhanced" />
      {q.ok && <p role="status" className="rounded-xl border border-green-300 bg-green-50 p-4 font-semibold text-green-900">Persetujuan dicatat.</p>}
      {q.e && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 font-semibold text-danger">Referensi persetujuan belum diisi. Isi referensi persetujuan mitra hukum, minimal 3 karakter.</p>}
      <section className="space-y-2 rounded-2xl border border-line bg-surface p-5">
        <p>Versi rubrik: <strong>{RUBRIC_VERSION}</strong> (butir M1 sampai M7 dari docs/DEEP_REVIEW.md).</p>
        <p>Status: {row ? `Disetujui mitra hukum (referensi: ${row.signoff_ref})` : "Belum disetujui. Enhanced tidak dapat diterbitkan."}</p>
        <p>Pembelian Deep Review: {flags.deepReviewPurchase ? "aktif" : "nonaktif"}. Penerbitan Enhanced: {flags.enhancedIssuance ? "aktif" : "nonaktif"} (diatur lewat variabel lingkungan).</p>
      </section>
      {!row && (
        <form action={approveRubricAction} className="space-y-3">
          <label className="block"><span className={labelText}>Referensi persetujuan tertulis mitra hukum (Wajib)</span>
            <input name="signoffRef" required minLength={3} maxLength={200} className={fieldClass} />
          </label>
          <p>Mencatat persetujuan tidak mengaktifkan Enhanced. Penerbitan Enhanced di produksi tetap diatur terpisah.</p>
          <button type="submit" className={buttonClass("primary")}>Catat persetujuan</button>
        </form>
      )}
    </main>
  );
}

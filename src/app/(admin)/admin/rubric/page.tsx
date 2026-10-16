import { getPool } from "@/lib/db";
import { flags } from "@/lib/flags";
import { RUBRIC_VERSION } from "@/lib/deep/rubric";
import { approveRubricAction } from "./actions";

export const dynamic = "force-dynamic";

// Admin hanya mencatat bahwa mitra hukum sudah menyetujui rubrik (referensi wajib). Admin tidak menilai isi hukum.
export default async function RubricPage({ searchParams }: { searchParams: Promise<{ e?: string; ok?: string }> }) {
  const q = await searchParams;
  const row = (await getPool().query("select signoff_ref, approved_at from rubric_approvals where policy_version = $1", [RUBRIC_VERSION])).rows[0];
  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-3xl font-semibold">Persetujuan rubrik Enhanced</h1>
      {q.ok && <p role="status" className="rounded-lg border border-line bg-white p-3">Persetujuan dicatat.</p>}
      {q.e && <p role="alert" className="font-semibold text-danger">Isi referensi persetujuan mitra (minimal 3 karakter).</p>}
      <section className="space-y-2 rounded-lg border border-line bg-white p-4">
        <p>Versi rubrik: <strong>{RUBRIC_VERSION}</strong> (butir M1–M7 dari docs/DEEP_REVIEW.md).</p>
        <p>Status: {row ? `Disetujui mitra — ${row.signoff_ref}` : "Belum disetujui. Enhanced tidak dapat diterbitkan."}</p>
        <p>Flag pembelian Deep Review: {flags.deepReviewPurchase ? "aktif" : "mati"}. Flag penerbitan Enhanced: {flags.enhancedIssuance ? "aktif" : "mati"} (diatur lewat variabel lingkungan).</p>
      </section>
      {!row && (
        <form action={approveRubricAction} className="space-y-3">
          <label className="block"><span className="font-medium">Referensi persetujuan tertulis mitra hukum (Wajib)</span>
            <input name="signoffRef" required minLength={3} maxLength={200} className="mt-1 block min-h-12 w-full rounded-lg border border-slate-400 px-3" />
          </label>
          <p>Mencatat persetujuan tidak mengaktifkan Enhanced; flag produksi tetap diatur terpisah.</p>
          <button type="submit" className="min-h-12 rounded-lg bg-brand hover:bg-brand-dark px-5 font-semibold text-white">Catat persetujuan</button>
        </form>
      )}
    </main>
  );
}

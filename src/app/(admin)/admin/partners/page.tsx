import { PageHeading } from "@/components/ui/card";
import { fieldClass, labelText } from "@/components/ui/field";
import { buttonClass } from "@/components/ui/button";
import { adminService } from "@/lib/admin/runtime";
import { getSessionRoles } from "@/lib/supabase/server";
import { addMemberAction, authorizeAction, registerFirmAction, revokeAuthorizationAction } from "./actions";
import { fixedText } from "@/lib/query-text";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mitra hukum | Admin Yuktanya" };
const MSG: Record<string, string> = {
  NAME: "Nama firma minimal 2 karakter.", NO_USER: "Email itu belum terdaftar. Minta orangnya mendaftar dulu.", SELF_GRANT: "Admin tidak dapat memberi dirinya sendiri kewenangan profesional.",
  FORBIDDEN: "Tidak berwenang.", NOT_A_MEMBER: "Jadikan anggota firma terlebih dahulu.", DATES: "Tanggal tidak valid.",
};

export default async function PartnersPage({ searchParams }: { searchParams: Promise<{ e?: string; ok?: string }> }) {
  const q = await searchParams;
  const s = (await getSessionRoles())!;
  const rows = await adminService().partners(s.userId);
  const firms = [...new Map(rows.map((r) => [r.firmId, r])).values()];
  return (
    <main className="max-w-5xl space-y-8">
      <PageHeading title="Mitra hukum" />
      <p>Admin hanya mencatat firma, anggota, dan otorisasi profesional yang sudah diverifikasi di luar sistem. Admin tidak dapat memberi dirinya kewenangan profesional dan tidak menerbitkan hasil pemeriksaan.</p>
      {q.ok && <p role="status" className="rounded-xl border border-green-300 bg-green-50 p-4 font-semibold text-green-900">Tersimpan.</p>}
      {q.e && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 font-semibold text-danger">{fixedText(MSG, q.e) ?? "Terjadi kendala."}</p>}

      <form action={registerFirmAction} className="space-y-3 rounded-2xl border border-line bg-white p-5">
        <h2 className="text-xl font-bold text-navy md:text-2xl">Daftarkan firma</h2>
        <label className="block"><span className={labelText}>Nama firma (Wajib)</span><input name="name" required minLength={2} maxLength={120} className={fieldClass} /></label>
        <label className="flex min-h-12 items-center gap-3"><input type="checkbox" name="isDefault" value="yes" className="h-6 w-6" /><span>Jadikan firma bawaan untuk permintaan baru</span></label>
        <button type="submit" className={buttonClass("primary")}>Daftarkan</button>
      </form>

      {firms.map((f) => (
        <section key={f.firmId} aria-label={f.firmName} className="space-y-3 rounded-2xl border border-line bg-white p-5">
          <h2 className="text-xl font-bold text-navy md:text-2xl">{f.firmName}{f.isDefault ? " (bawaan)" : ""}</h2>
          <ul className="space-y-2">
            {rows.filter((r) => r.firmId === f.firmId && r.userId).map((r) => (
              <li key={`${r.userId}-${r.authorizationId ?? "x"}`} className="space-y-1">
                <p className="break-words">{r.role === "coordinator" ? "Koordinator" : "Reviewer"} {r.email ?? r.userId?.slice(0, 8)}{r.authorizationId ? ` · otorisasi ${r.validFrom} s/d ${r.validTo}${r.revokedAt ? " · DICABUT" : ""}` : r.role === "reviewer" ? " · belum berotorisasi" : ""}</p>
                {r.authorizationId && !r.revokedAt && (
                  <form action={revokeAuthorizationAction}><input type="hidden" name="authId" value={r.authorizationId} /><button type="submit" className={buttonClass("secondary")}>Cabut otorisasi</button></form>
                )}
              </li>
            ))}
          </ul>
          <form action={addMemberAction} className="space-y-3">
            <h3 className="text-lg font-bold text-navy">Tambah anggota</h3>
            <input type="hidden" name="firmId" value={f.firmId} />
            <label className="block"><span className={labelText}>Email akun (Wajib)</span><input name="email" type="email" required className={fieldClass} /></label>
            <label className="block"><span className={labelText}>Peran</span><select name="role" className={fieldClass}><option value="reviewer">Reviewer</option><option value="coordinator">Koordinator</option></select></label>
            <button type="submit" className={buttonClass("secondary")}>Tambahkan</button>
          </form>
          <form action={authorizeAction} className="space-y-3">
            <h3 className="text-lg font-bold text-navy">Beri otorisasi profesional</h3>
            <input type="hidden" name="firmId" value={f.firmId} />
            <label className="block"><span className={labelText}>Email reviewer (Wajib)</span><input name="email" type="email" required className={fieldClass} /></label>
            <label className="block"><span className={labelText}>Lingkup</span><input name="scope" maxLength={500} className={fieldClass} /></label>
            <label className="block"><span className={labelText}>Berlaku dari</span><input name="validFrom" type="date" required className={fieldClass} /></label>
            <label className="block"><span className={labelText}>Berlaku sampai</span><input name="validTo" type="date" required className={fieldClass} /></label>
            <button type="submit" className={buttonClass("primary")}>Beri otorisasi</button>
          </form>
        </section>
      ))}
    </main>
  );
}

import { adminService } from "@/lib/admin/runtime";
import { getSessionRoles } from "@/lib/supabase/server";
import { addMemberAction, authorizeAction, registerFirmAction, revokeAuthorizationAction } from "./actions";

export const dynamic = "force-dynamic";
const MSG: Record<string, string> = {
  NAME: "Nama firma minimal 2 karakter.", NO_USER: "Email itu belum terdaftar. Minta orangnya mendaftar dulu.", SELF_GRANT: "Admin tidak dapat memberi dirinya sendiri kewenangan profesional.",
  FORBIDDEN: "Tidak berwenang.", NOT_A_MEMBER: "Jadikan anggota firma terlebih dahulu.", DATES: "Tanggal tidak valid.",
};
const field = "mt-1 block min-h-12 w-full rounded-lg border border-slate-400 px-3";
const btn = "min-h-12 rounded-lg px-5 font-semibold";

export default async function PartnersPage({ searchParams }: { searchParams: Promise<{ e?: string; ok?: string }> }) {
  const q = await searchParams;
  const s = (await getSessionRoles())!;
  const rows = await adminService().partners(s.userId);
  const firms = [...new Map(rows.map((r) => [r.firmId, r])).values()];
  return (
    <main className="mx-auto max-w-4xl space-y-8 p-6">
      <h1 className="text-3xl font-semibold">Mitra hukum</h1>
      <p>Admin hanya mencatat firma, anggota, dan otorisasi profesional yang sudah diverifikasi di luar sistem. Admin tidak dapat memberi dirinya kewenangan profesional dan tidak menerbitkan hasil pemeriksaan.</p>
      {q.ok && <p role="status" className="rounded-lg border border-line bg-white p-3">Tersimpan.</p>}
      {q.e && <p role="alert" className="font-semibold text-danger">{MSG[q.e] ?? "Terjadi kendala."}</p>}

      <form action={registerFirmAction} className="space-y-3 rounded-lg border border-line bg-white p-4">
        <h2 className="text-xl font-semibold">Daftarkan firma</h2>
        <label className="block"><span className="font-medium">Nama firma (Wajib)</span><input name="name" required minLength={2} maxLength={120} className={field} /></label>
        <label className="flex min-h-12 items-center gap-3"><input type="checkbox" name="isDefault" value="yes" className="h-6 w-6" /><span>Jadikan firma bawaan untuk permintaan baru</span></label>
        <button type="submit" className={`${btn} bg-brand hover:bg-brand-dark text-white`}>Daftarkan</button>
      </form>

      {firms.map((f) => (
        <section key={f.firmId} aria-label={f.firmName} className="space-y-3 rounded-lg border border-line bg-white p-4">
          <h2 className="text-xl font-semibold">{f.firmName}{f.isDefault ? " (bawaan)" : ""}</h2>
          <ul className="space-y-2">
            {rows.filter((r) => r.firmId === f.firmId && r.userId).map((r) => (
              <li key={`${r.userId}-${r.authorizationId ?? "x"}`} className="space-y-1">
                <p>{r.role === "coordinator" ? "Koordinator" : "Reviewer"} {r.email ?? r.userId?.slice(0, 8)}{r.authorizationId ? ` · otorisasi ${r.validFrom} s/d ${r.validTo}${r.revokedAt ? " · DICABUT" : ""}` : r.role === "reviewer" ? " · belum berotorisasi" : ""}</p>
                {r.authorizationId && !r.revokedAt && (
                  <form action={revokeAuthorizationAction}><input type="hidden" name="authId" value={r.authorizationId} /><button type="submit" className={`${btn} border border-slate-400 bg-white`}>Cabut otorisasi</button></form>
                )}
              </li>
            ))}
          </ul>
          <form action={addMemberAction} className="space-y-3">
            <h3 className="text-lg font-semibold">Tambah anggota</h3>
            <input type="hidden" name="firmId" value={f.firmId} />
            <label className="block"><span className="font-medium">Email akun (Wajib)</span><input name="email" type="email" required className={field} /></label>
            <label className="block"><span className="font-medium">Peran</span><select name="role" className={field}><option value="reviewer">Reviewer</option><option value="coordinator">Koordinator</option></select></label>
            <button type="submit" className={`${btn} border border-slate-400 bg-white`}>Tambahkan</button>
          </form>
          <form action={authorizeAction} className="space-y-3">
            <h3 className="text-lg font-semibold">Beri otorisasi profesional</h3>
            <input type="hidden" name="firmId" value={f.firmId} />
            <label className="block"><span className="font-medium">Email reviewer (Wajib)</span><input name="email" type="email" required className={field} /></label>
            <label className="block"><span className="font-medium">Lingkup</span><input name="scope" maxLength={500} className={field} /></label>
            <label className="block"><span className="font-medium">Berlaku dari</span><input name="validFrom" type="date" required className={field} /></label>
            <label className="block"><span className="font-medium">Berlaku sampai</span><input name="validTo" type="date" required className={field} /></label>
            <button type="submit" className={`${btn} bg-brand hover:bg-brand-dark text-white`}>Beri otorisasi</button>
          </form>
        </section>
      ))}
    </main>
  );
}

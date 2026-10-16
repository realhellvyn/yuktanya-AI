import { redirect } from "next/navigation";
import { getPool } from "@/lib/db";
import { getSessionRoles } from "@/lib/supabase/server";
import { revokeVerificationAction } from "./actions";

export const dynamic = "force-dynamic";
const STATUS: Record<string, string> = { ACTIVE: "Aktif", REVOKED: "Dicabut", SUSPENDED: "Ditangguhkan sementara" };
const KIND: Record<string, string> = { AI: "AI Verified", LEGAL: "Legal Verified", LEGAL_ENHANCED: "Legal Verified — Enhanced" };
const ERR: Record<string, string> = { NOTE: "Isi catatan alasan (minimal 5 karakter).", NOT_FOUND: "Verifikasi tidak ditemukan.", FORBIDDEN: "Tidak berwenang.", INVALID_REASON: "Alasan tidak valid." };
const field = "mt-1 block min-h-12 w-full rounded-lg border border-slate-400 px-3";

// Admin hanya mencabut secara operasional; admin tidak menilai temuan hukum. Daftar hanya memuat metadata (tanpa isi dokumen).
export default async function VerificationsAdminPage({ searchParams }: { searchParams: Promise<{ q?: string; e?: string; ok?: string }> }) {
  const session = await getSessionRoles();
  if (!session || !session.roles.includes("platform_admin")) redirect("/login");
  const q = await searchParams;
  const code = (q.q ?? "").trim();
  const rows = /^[A-Za-z0-9_-]{8,128}$/.test(code)
    ? (await getPool().query("select id, kind, status, outcome, issued_at, code from document_verifications where code like $1 order by issued_at desc limit 10", [`${code}%`])).rows
    : (await getPool().query("select id, kind, status, outcome, issued_at, code from document_verifications order by issued_at desc limit 10")).rows;
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-3xl font-semibold">Pencabutan verifikasi</h1>
      {q.ok && <p role="status" className="rounded-lg border border-line bg-white p-3">Verifikasi dicabut. Halaman publik langsung menampilkan status Dicabut.</p>}
      {q.e && <p role="alert" className="font-semibold text-danger">{ERR[q.e] ?? "Terjadi kendala."}</p>}
      <form className="flex flex-wrap items-end gap-3">
        <label className="block"><span className="font-medium">Awalan kode (minimal 8 karakter)</span><input name="q" defaultValue={code} className={field} /></label>
        <button type="submit" className="min-h-12 rounded-lg border border-slate-400 bg-white px-5 font-medium">Cari</button>
      </form>
      <ul className="space-y-4">
        {rows.map((r) => (
          <li key={r.id} className="space-y-2 rounded-lg border border-line bg-white p-4">
            <p className="font-semibold">{KIND[r.kind] ?? r.kind} · Status: {STATUS[r.status] ?? r.status}</p>
            <p className="font-mono break-all">{r.code}</p>
            {r.status !== "REVOKED" && (
              <form action={revokeVerificationAction} className="space-y-2">
                <input type="hidden" name="id" value={r.id} />
                <label className="block"><span className="font-medium">Alasan</span>
                  <select name="reason" className={field}><option value="ERROR">Terdapat kesalahan</option><option value="MISLEADING">Menyesatkan</option><option value="AUTHORITY_REVOKED">Otoritas pemeriksa dicabut</option><option value="OWNER_REQUEST">Permintaan pemilik</option><option value="OTHER">Lainnya</option></select>
                </label>
                <label className="block"><span className="font-medium">Catatan pribadi (Wajib, tidak tampil publik)</span><input name="note" required minLength={5} maxLength={2000} className={field} /></label>
                <button type="submit" className="min-h-12 rounded-lg bg-brand hover:bg-brand-dark px-5 font-semibold text-white">Cabut verifikasi</button>
              </form>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}

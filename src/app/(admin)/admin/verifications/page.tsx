import { PageHeading } from "@/components/ui/card";
import { fieldClass, labelText } from "@/components/ui/field";
import { buttonClass } from "@/components/ui/button";
import { redirect } from "next/navigation";
import { getPool } from "@/lib/db";
import { getSessionRoles } from "@/lib/supabase/server";
import { revokeVerificationAction } from "./actions";
import { fixedText } from "@/lib/query-text";
import { VERIFICATION_STATEMENTS } from "@/lib/copy";
import { VerificationMedal } from "@/components/verification/verification-medal";
import { medalFor } from "@/lib/verification/medal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pencabutan verifikasi | Admin Yuktanya" };
const STATUS: Record<string, string> = { ACTIVE: "Aktif", REVOKED: "Dicabut", SUSPENDED: "Ditangguhkan sementara" };
const KIND: Record<string, string> = { AI: "AI Verified", LEGAL: "Legal Verified", LEGAL_ENHANCED: "Legal Verified Enhanced" };
const ERR: Record<string, string> = { NOTE: "Catatan alasan belum diisi. Isi minimal 5 karakter.", NOT_FOUND: "Verifikasi tidak ditemukan. Periksa kembali kodenya.", FORBIDDEN: "Akun Anda tidak berwenang melakukan tindakan ini.", INVALID_REASON: "Alasan tidak valid. Pilih alasan dari daftar." };

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
    <main className="max-w-5xl space-y-6">
      <PageHeading title="Pencabutan verifikasi" />
      {q.ok && <p role="status" className="rounded-xl border border-green-300 bg-green-50 p-4 font-semibold text-green-900">Verifikasi dicabut. Halaman publik langsung menampilkan status Dicabut.</p>}
      {q.e && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 font-semibold text-danger">{fixedText(ERR, q.e) ?? "Tindakan belum berhasil. Muat ulang halaman, lalu coba lagi."}</p>}
      <form className="flex flex-wrap items-end gap-3">
        <label className="block min-w-0 flex-1 basis-56"><span className={labelText}>Awalan kode (minimal 8 karakter)</span><input name="q" defaultValue={code} className={fieldClass} /></label>
        <button type="submit" className={buttonClass("secondary")}>Cari kode</button>
      </form>
      <ul className="space-y-4">
        {rows.map((r) => {
          // Medali hanya untuk rekaman Aktif, dari jenis/status/hasil yang tersimpan (tanpa keputusan baru di halaman admin).
          const medal = medalFor(r.kind, r.status, r.outcome);
          return (
            <li key={r.id} className="space-y-2 rounded-2xl border border-line bg-surface p-5">
              {medal && <VerificationMedal tier={medal.tier} note={medal.note} size="sm" />}
              <p className="font-semibold text-navy">{KIND[r.kind] ?? r.kind} · Status: {STATUS[r.status] ?? r.status}</p>
              {/* Medali bronze selalu disertai pernyataan bahwa AI Verified bukan pemeriksaan profesional. */}
            {r.kind === "AI" && <p>{VERIFICATION_STATEMENTS.AI}</p>}
            <p className="font-mono break-all">{r.code}</p>
              {r.status !== "REVOKED" && (
                <form action={revokeVerificationAction} className="space-y-2">
                  <input type="hidden" name="id" value={r.id} />
                  <label className="block"><span className={labelText}>Alasan</span>
                    <select name="reason" className={fieldClass}><option value="ERROR">Terdapat kesalahan</option><option value="MISLEADING">Menyesatkan</option><option value="AUTHORITY_REVOKED">Otoritas pemeriksa dicabut</option><option value="OWNER_REQUEST">Permintaan pemilik dokumen</option><option value="OTHER">Lainnya</option></select>
                  </label>
                  <label className="block"><span className={labelText}>Catatan pribadi (Wajib, tidak tampil publik)</span><input name="note" required minLength={5} maxLength={2000} className={fieldClass} /></label>
                  <button type="submit" className={buttonClass("primary")}>Cabut verifikasi</button>
                </form>
              )}
            </li>
          );
        })}
      </ul>
    </main>
  );
}

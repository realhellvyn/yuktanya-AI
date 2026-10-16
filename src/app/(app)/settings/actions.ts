"use server";

import { redirect } from "next/navigation";
import { getPool } from "@/lib/db";
import { getBlobStore } from "@/lib/documents/runtime";
import { requireUserId } from "@/lib/documents/session";
import { CONFIRM_WORD, eraseAccount } from "@/lib/retention/erasure";
import { supabaseAuthAdmin } from "@/lib/retention/runtime";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Hapus akun: sesi & peran diperiksa ulang di server; ID akun hanya dari sesi, bukan dari formulir.
export async function deleteAccountAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const typed = String(formData.get("confirm") ?? "").trim().toUpperCase();
  if (typed !== CONFIRM_WORD) redirect("/settings/hapus-akun?e=confirm");
  let result;
  try {
    result = await eraseAccount({ pool: getPool(), blob: getBlobStore(), auth: supabaseAuthAdmin() }, userId);
  } catch {
    redirect("/settings/hapus-akun?e=error");
  }
  if (result.status === "BLOCKED") redirect("/settings/hapus-akun?e=blocked");
  if (result.status === "NOT_FOUND") redirect("/settings/hapus-akun?e=error");
  try {
    // Sesi lokal dibersihkan (cookie). Token lama tidak berguna: akun Auth sudah dihapus dan semua peran dicabut.
    await (await createSupabaseServerClient()).auth.signOut({ scope: "local" });
  } catch {
    // diabaikan: peran sudah dicabut sehingga sesi tidak lagi membuka halaman yang dilindungi
  }
  redirect(result.authDeleted ? "/akun-dihapus" : "/akun-dihapus?sebagian=1");
}

import type { BlobStore } from "@/lib/documents/blob";

// Minimal agar tes unit dapat memakai palsu; pg.Pool memenuhinya.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Queryable = { query(sql: string, args?: unknown[]): Promise<{ rows: any[] }> };

// Adapter penghapusan akun Auth. Produksi: Supabase Admin API (service role) dengan soft delete; tes memakai palsu.
export interface AuthAdmin {
  deleteUser(userId: string): Promise<void>;
}

export type EraseBlocker = "STAFF_ACCOUNT" | "REVIEW_IN_PROGRESS" | "SPECIAL_CASE_OPEN" | "PAYMENT_PENDING";
export type EraseResult =
  | { status: "ERASED"; filesFailed: number; authDeleted: boolean }
  | { status: "BLOCKED"; reasons: string[] }
  | { status: "NOT_FOUND" };

// Kata yang harus diketik pengguna untuk mengonfirmasi penghapusan akun.
export const CONFIRM_WORD = "HAPUS";

export const ERASE_BLOCK_MESSAGES: Record<string, string> = {
  STAFF_ACCOUNT: "Akun mitra hukum atau admin tidak dapat dihapus dari sini. Hubungi admin platform.",
  REVIEW_IN_PROGRESS: "Masih ada pemeriksaan pengacara (Review Standar atau Pemeriksaan Mendalam) yang sedang berjalan. Tunggu sampai selesai, lalu coba lagi.",
  SPECIAL_CASE_OPEN: "Masih ada Kasus Hukum Khusus yang terbuka. Tarik permintaan atau tunggu sampai kasus ditutup, lalu coba lagi.",
  PAYMENT_PENDING: "Masih ada pembayaran yang menunggu atau sedang dicocokkan. Tunggu sampai selesai atau batas waktu bayar lewat, lalu coba lagi.",
};

export async function erasureBlockers(pool: Queryable, userId: string, now: Date = new Date()): Promise<string[]> {
  const { rows } = await pool.query("select account_erasure_blockers($1, $2) as b", [userId, now]);
  return (rows[0]?.b as string[] | null) ?? [];
}

// Urutan: (1) DB dalam satu transaksi (hapus/anonimkan; gagal → tidak ada yang berubah), (2) berkas privat yang jalurnya
// dikembalikan DB (kegagalan dihitung, tidak membatalkan), (3) akun Auth. ALREADY_ERASED tetap mencoba langkah 3 agar
// percobaan ulang setelah Auth gagal dapat menuntaskan penghapusan.
export async function eraseAccount(deps: { pool: Queryable; blob: BlobStore; auth: AuthAdmin }, userId: string, now: Date = new Date()): Promise<EraseResult> {
  const { rows } = await deps.pool.query("select erase_account($1, $2) as r", [userId, now]);
  const r = rows[0].r as { status: string; reasons?: string[]; storage_paths?: string[] };
  if (r.status === "BLOCKED") return { status: "BLOCKED", reasons: r.reasons ?? [] };
  if (r.status === "NOT_FOUND") return { status: "NOT_FOUND" };
  let filesFailed = 0;
  for (const p of r.storage_paths ?? []) {
    try {
      await deps.blob.delete(p);
    } catch {
      filesFailed++;
    }
  }
  let authDeleted = true;
  try {
    await deps.auth.deleteUser(userId);
  } catch {
    authDeleted = false;
  }
  return { status: "ERASED", filesFailed, authDeleted };
}

import type { BlobStore } from "@/lib/documents/blob";

// Minimal agar tes unit dapat memakai palsu; pg.Pool memenuhinya.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Queryable = { query(sql: string, args?: unknown[]): Promise<{ rows: any[] }> };

// Adapter penghapusan akun Auth. Produksi: Supabase Admin API (service role) dengan soft delete; tes memakai palsu.
export interface AuthAdmin {
  deleteUser(userId: string): Promise<void>;
}

export type EraseBlocker = "STAFF_ACCOUNT" | "STANDARD_IN_PROGRESS" | "DEEP_IN_PROGRESS" | "SPECIAL_CASE_OPEN" | "PAYMENT_RECONCILIATION" | "PAYMENT_PENDING";
export type EraseResult =
  | { status: "ERASED"; filesFailed: number; authDeleted: boolean }
  | { status: "BLOCKED"; reasons: string[] }
  | { status: "NOT_FOUND" };

// Kata yang harus diketik pengguna untuk mengonfirmasi penghapusan akun.
export const CONFIRM_WORD = "HAPUS";

export const ERASE_BLOCK_MESSAGES: Record<EraseBlocker, string> & Record<string, string | undefined> = {
  STAFF_ACCOUNT: "Akun ini terdaftar sebagai mitra hukum atau admin, sehingga tidak dapat dihapus sendiri. Hubungi admin platform agar akses Anda dicabut lebih dulu.",
  STANDARD_IN_PROGRESS: "Legal Review Anda masih dikerjakan pengacara. Tunggu sampai hasilnya terbit di Legal Review Saya, lalu coba lagi.",
  DEEP_IN_PROGRESS: "Deep Review Anda masih berjalan atau sedang ditahan. Tunggu sampai selesai. Bila pemeriksaan ditahan dan Anda ingin berhenti, hubungi tim Yuktanya (lihat halaman Bantuan) agar pembayarannya diselesaikan lebih dulu.",
  SPECIAL_CASE_OPEN: "Special Legal Case Anda masih terbuka. Tarik permintaan dari halaman kasus, atau tunggu sampai kasus ditutup, lalu coba lagi.",
  PAYMENT_RECONCILIATION: "Ada pembayaran yang sedang dicocokkan tim kami. Tunggu sampai pencocokan selesai, atau hubungi tim Yuktanya (lihat halaman Bantuan).",
  PAYMENT_PENDING: "Ada pesanan yang menunggu pembayaran. Selesaikan pembayarannya, atau tunggu sampai batas waktu pembayaran lewat (pesanan batal otomatis), lalu coba lagi.",
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

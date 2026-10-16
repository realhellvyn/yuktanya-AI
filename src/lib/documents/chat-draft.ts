// Draf pesan percakapan yang belum terkirim, disimpan di localStorage perangkat ini saja (bukan server).
// Setiap akses dibungkus try/catch: mode privat, kuota penuh, atau penyimpanan diblokir tidak boleh merusak halaman.
export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type EnumerableStorage = DraftStorage & { readonly length: number; key(index: number): string | null };

export const DRAFT_PREFIX = "yuktanya:chat-draft:";
const MAX_AGE_MS = 7 * 86_400_000;
const OWNER_KEY = "yuktanya:chat-draft-owner";
const keyOf = (documentId: string) => `${DRAFT_PREFIX}${documentId}`;

export function safeLocalStorage(): EnumerableStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function saveDraft(storage: DraftStorage | null | undefined, documentId: string, text: string, now = Date.now()): boolean {
  if (!storage) return false;
  try {
    if (!text.trim()) storage.removeItem(keyOf(documentId));
    else storage.setItem(keyOf(documentId), JSON.stringify({ text, savedAt: now }));
    return true;
  } catch {
    return false;
  }
}

export function loadDraft(storage: DraftStorage | null | undefined, documentId: string, now = Date.now()): string | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(keyOf(documentId));
    if (!raw) return null;
    const v = JSON.parse(raw) as { text?: unknown; savedAt?: unknown };
    if (typeof v.text !== "string" || typeof v.savedAt !== "number" || now - v.savedAt > MAX_AGE_MS || !v.text.trim()) {
      storage.removeItem(keyOf(documentId));
      return null;
    }
    return v.text;
  } catch {
    return null;
  }
}

export function clearDraft(storage: DraftStorage | null | undefined, documentId: string): void {
  try {
    storage?.removeItem(keyOf(documentId));
  } catch {
    // diabaikan: halaman tetap berjalan tanpa penyimpanan
  }
}

// Dipakai saat keluar akun dan setelah akun dihapus: buang semua draf Yuktanya di perangkat ini.
export function clearAllDrafts(storage: EnumerableStorage | null | undefined): void {
  if (!storage) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k?.startsWith(DRAFT_PREFIX)) keys.push(k);
    }
    keys.forEach((k) => storage.removeItem(k));
    storage.removeItem(OWNER_KEY);
  } catch {
    // diabaikan
  }
}

// Draf hanya untuk akun yang menulisnya: bila akun lain membuka percakapan di perangkat yang sama, semua draf lama dibuang.
export function claimDrafts(storage: EnumerableStorage | null | undefined, userId: string): void {
  if (!storage) return;
  try {
    if (storage.getItem(OWNER_KEY) === userId) return;
    clearAllDrafts(storage);
    storage.setItem(OWNER_KEY, userId);
  } catch {
    // diabaikan
  }
}

// Setelah halaman dimuat ulang (kirim berhasil/gagal, dialihkan ke login, atau muat ulang):
// pesan terakhir pengguna sama dengan draf → sudah tersimpan di server, draf dibuang; selain itu draf dikembalikan.
export function reconcileDraft(draft: string | null, lastUserMessage: string | undefined): "none" | "clear" | "restore" {
  if (!draft) return "none";
  if (lastUserMessage !== undefined && lastUserMessage.trim() === draft.trim()) return "clear";
  return "restore";
}

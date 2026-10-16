import type { Pool } from "pg";
import { RECORDED_EVENT_NAMES, sanitizeMetadata, type SafeMetadata } from "./catalogue";

export type { SafeMetadata } from "./catalogue";
type Queryable = Pick<Pool, "query">;
type EventInput = { name: string; actorUserId?: string; entityType?: string; entityId?: string; dedupeKey: string; metadata?: SafeMetadata };

// Catatan wajib (mis. persetujuan): galat diteruskan ke pemanggil. Metadata disaring daftar-izin, tetapi bila penyaringan
// mengubah masukan (kunci/nilai dibuang) catatan wajib TIDAK ditulis dan galat dilempar, agar bukti tidak tersimpan kurang lengkap.
// Jangan pernah memasukkan isi dokumen, prompt, atau nama.
export async function recordEvent(pool: Queryable, e: EventInput): Promise<void> {
  const input = e.metadata ?? {};
  const safe = sanitizeMetadata(input);
  const inKeys = Object.keys(input);
  if (inKeys.length !== Object.keys(safe).length || inKeys.some((k) => safe[k] !== input[k])) throw new Error("EVENT_METADATA_REJECTED");
  await pool.query(
    `insert into product_events (actor_user_id, event_name, entity_type, entity_id, dedupe_key, metadata_safe)
     values ($1, $2, $3, $4, $5, $6) on conflict (dedupe_key) do nothing`,
    [e.actorUserId ?? null, e.name, e.entityType ?? null, e.entityId ?? null, e.dedupeKey, JSON.stringify(safe)],
  );
}

// Event analitik best-effort: tidak pernah melempar galat dan tidak pernah memblokir transaksi bisnis.
// Nama harus ada di katalog; DB memeriksa ulang nama dan menyaring metadata (record_product_event).
export async function trackEvent(pool: Queryable, e: EventInput & { occurredAt?: Date }): Promise<boolean> {
  if (!RECORDED_EVENT_NAMES.includes(e.name)) return false;
  try {
    const { rows } = await pool.query("select record_product_event($1, $2, $3, $4, $5, $6, $7) as ok", [
      e.actorUserId ?? null, e.name, e.entityType ?? null, e.entityId ?? null, e.dedupeKey, e.occurredAt ?? new Date(), JSON.stringify(sanitizeMetadata(e.metadata)),
    ]);
    return rows[0]?.ok === true;
  } catch {
    return false;
  }
}

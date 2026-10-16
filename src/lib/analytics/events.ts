import type { Pool } from "pg";

export type SafeMetadata = Record<string, string | number | boolean>;

// Event produk aman: hanya ID dan angka. Jangan pernah memasukkan isi dokumen, prompt, atau nama.
export async function recordEvent(
  pool: Pool,
  e: { name: string; actorUserId?: string; entityType?: string; entityId?: string; dedupeKey: string; metadata?: SafeMetadata },
): Promise<void> {
  await pool.query(
    `insert into product_events (actor_user_id, event_name, entity_type, entity_id, dedupe_key, metadata_safe)
     values ($1, $2, $3, $4, $5, $6) on conflict (dedupe_key) do nothing`,
    [e.actorUserId ?? null, e.name, e.entityType ?? null, e.entityId ?? null, e.dedupeKey, JSON.stringify(e.metadata ?? {})],
  );
}

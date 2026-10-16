import type { Pool } from "pg";

export type Message = { id: string; seq: number; role: "user" | "assistant"; content: string; answered: boolean; createdAt: string };

async function assertOwner(pool: Pool, userId: string, documentId: string): Promise<void> {
  const { rowCount } = await pool.query("select 1 from documents where id = $1 and owner_id = $2", [documentId, userId]);
  if (!rowCount) throw new Error("NOT_FOUND");
}

// Hanya pemilik dokumen yang dapat membaca percakapan; bukan pemilik → daftar kosong (tanpa membocorkan keberadaan).
export async function listMessages(pool: Pool, userId: string, documentId: string): Promise<Message[]> {
  const { rows } = await pool.query(
    `select m.id, m.seq, m.role, m.content, m.answered, m.created_at
       from document_messages m join documents d on d.id = m.document_id
      where m.document_id = $1 and d.owner_id = $2 order by m.seq`,
    [documentId, userId],
  );
  return rows.map((r) => ({ id: r.id, seq: Number(r.seq), role: r.role, content: r.content, answered: r.answered, createdAt: r.created_at.toISOString() }));
}

export async function saveUserMessage(pool: Pool, userId: string, documentId: string, content: string, key: string): Promise<{ id: string; seq: number; duplicate: boolean }> {
  await assertOwner(pool, userId, documentId);
  const ins = await pool.query(
    `insert into document_messages (document_id, role, content, idempotency_key) values ($1, 'user', $2, $3)
       on conflict (document_id, idempotency_key) where role = 'user' do nothing returning id, seq`,
    [documentId, content, key],
  );
  if (ins.rows[0]) return { id: ins.rows[0].id, seq: Number(ins.rows[0].seq), duplicate: false };
  const { rows } = await pool.query("select id, seq from document_messages where document_id = $1 and role = 'user' and idempotency_key = $2", [documentId, key]);
  return { id: rows[0].id, seq: Number(rows[0].seq), duplicate: true };
}

// Balasan AI disimpan, lalu pesan pengguna sampai batas seq (yang benar-benar dibaca giliran ini) ditandai terjawab.
export async function saveAssistantReply(pool: Pool, userId: string, documentId: string, content: string, upToSeq = Number.MAX_SAFE_INTEGER): Promise<void> {
  await assertOwner(pool, userId, documentId);
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("update document_messages set answered = true where document_id = $1 and role = 'user' and not answered and seq <= $2", [documentId, upToSeq]);
    await c.query("insert into document_messages (document_id, role, content, answered) values ($1, 'assistant', $2, true)", [documentId, content]);
    await c.query("commit");
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}

// Giliran dengan kunci ini: pesan pengguna + balasan pertama sesudahnya (null bila belum dijawab).
export async function findTurnByKey(pool: Pool, userId: string, documentId: string, key: string): Promise<{ userSeq: number; reply: string | null } | null> {
  const { rows } = await pool.query(
    `select m.seq,
            (select a.content from document_messages a where a.document_id = m.document_id and a.role = 'assistant' and a.seq > m.seq order by a.seq limit 1) as reply
       from document_messages m join documents d on d.id = m.document_id
      where m.document_id = $1 and d.owner_id = $2 and m.role = 'user' and m.idempotency_key = $3`,
    [documentId, userId, key],
  );
  return rows[0] ? { userSeq: Number(rows[0].seq), reply: rows[0].reply } : null;
}

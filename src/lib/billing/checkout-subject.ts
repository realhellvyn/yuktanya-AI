import type { Pool } from "pg";

export type OrderSubject = { documentId: string; title: string; versionNo: number; sha256: string };

// Dokumen dan versi yang dibayar sebuah order pemeriksaan (checkout D-06). Hanya milik pemilik order; selain itu null.
// Standar: ref_id = versi. Deep: ref_id = permintaan pemeriksaan standar induk → versinya.
export async function orderSubject(pool: Pick<Pool, "query">, userId: string, order: { kind: string; refId: string | null }): Promise<OrderSubject | null> {
  if (!order.refId) return null;
  const sql =
    order.kind === "STANDARD_REVIEW"
      ? `select d.id, d.title, v.version_no, v.sha256 from document_versions v join documents d on d.id = v.document_id
          where v.id = $1 and d.owner_id = $2`
      : order.kind === "DEEP_REVIEW"
        ? `select d.id, d.title, v.version_no, v.sha256 from review_requests r join document_versions v on v.id = r.version_id
             join documents d on d.id = v.document_id where r.id = $1 and r.owner_id = $2 and d.owner_id = $2`
        : null;
  if (!sql) return null;
  const { rows } = await pool.query(sql, [order.refId, userId]);
  const r = rows[0];
  return r ? { documentId: r.id, title: r.title, versionNo: r.version_no, sha256: r.sha256 } : null;
}

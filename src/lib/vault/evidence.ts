import { createHash, randomUUID } from "node:crypto";
import JSZip from "jszip";
import type { Pool } from "pg";
import type { BlobStore } from "@/lib/documents/blob";
import { IntegrityError } from "@/lib/documents/service";
import { FeatureNotAvailableError } from "./features";

export class RateLimitedError extends Error {
  constructor() {
    super("RATE_LIMITED");
    this.name = "RateLimitedError";
  }
}

type Deps = { pool: Pool; blob: BlobStore };
const sha = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");

const README = `Paket bukti Yuktanya

Paket ini adalah kumpulan catatan sistem tentang riwayat satu dokumen: versi yang dibuat beserta kode hash SHA-256-nya,
ekspor berkas, tautan berbagi, dan konfirmasi baca. Paket ini bukan jaminan nilai pembuktian di pengadilan.

Versi dalam paket ini dibuat dengan bantuan AI dan belum diperiksa oleh profesional hukum, kecuali dinyatakan lain.
Konfirmasi baca hanya menyatakan seseorang sudah membaca versi tertentu dan bukan tanda tangan elektronik.

Cara memeriksa: setiap berkas tercantum di manifest.json bersama hash SHA-256 dan ukurannya. Hitung ulang hash berkas
untuk memastikan isinya tidak berubah. Berkas versions/v{n}.json memuat teks kanonik yang di-hash untuk versi tersebut.
`;

function mapDbError(e: unknown): never {
  const m = e instanceof Error ? e.message : "";
  if (m.includes("FEATURE_NOT_AVAILABLE")) throw new FeatureNotAvailableError();
  if (m.includes("RATE_LIMITED")) throw new RateLimitedError();
  throw e;
}

export async function buildEvidencePack(deps: Deps, userId: string, documentId: string, now: Date = new Date()): Promise<{ packId: string; sha256: string; byteSize: number } | null> {
  const { pool, blob } = deps;
  try {
    await pool.query("select evidence_precheck($1, $2, $3)", [userId, documentId, now]);
  } catch (e) {
    if (e instanceof Error && e.message.includes("NOT_FOUND")) return null;
    mapDbError(e);
  }

  const doc = (await pool.query("select id, title, category from documents where id = $1 and owner_id = $2", [documentId, userId])).rows[0];
  const versions = (await pool.query("select id, version_no, canonical_text, sha256, created_at from document_versions where document_id = $1 order by version_no", [documentId])).rows;
  const numbers = new Map<string, number>(versions.map((v) => [v.id as string, v.version_no as number]));
  const exportsRows = (await pool.query(
    `select e.version_id, e.format, e.sha256, e.byte_size, e.created_at from document_exports e
       join document_versions v on v.id = e.version_id where v.document_id = $1 order by e.created_at, e.id`, [documentId])).rows;
  const links = (await pool.query(
    `select s.version_id, s.created_at, s.expires_at, s.revoked_at,
            (select count(*) from share_events ev where ev.share_id = s.id and ev.kind = 'OPENED') as opened
       from share_links s join document_versions v on v.id = s.version_id where v.document_id = $1 order by s.created_at, s.id`, [documentId])).rows;
  const acks = (await pool.query(
    `select s.version_id, a.email, a.verified_at from acknowledgements a
       join share_links s on s.id = a.share_id join document_versions v on v.id = s.version_id
      where v.document_id = $1 order by a.verified_at, a.id`, [documentId])).rows;

  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  const files: [string, string][] = [
    ["README.txt", README],
    ["history.json", JSON.stringify({ document: { id: doc.id, title: doc.title, category: doc.category }, versions: versions.map((v) => ({ versionNo: v.version_no, sha256: v.sha256, createdAt: iso(v.created_at) })) }, null, 2)],
    ...versions.map((v): [string, string] => [`versions/v${v.version_no}.json`, JSON.stringify({ versionNo: v.version_no, sha256: v.sha256, createdAt: iso(v.created_at), canonicalText: v.canonical_text }, null, 2)]),
    ["exports.json", JSON.stringify(exportsRows.map((e) => ({ versionNo: numbers.get(e.version_id), format: e.format, sha256: e.sha256, byteSize: e.byte_size, createdAt: iso(e.created_at) })), null, 2)],
    ["shares.json", JSON.stringify({
      links: links.map((l) => ({ versionNo: numbers.get(l.version_id), createdAt: iso(l.created_at), expiresAt: iso(l.expires_at), revokedAt: iso(l.revoked_at), openedCount: Number(l.opened) })),
      acknowledgements: acks.map((a) => ({ versionNo: numbers.get(a.version_id), email: a.email, verifiedAt: iso(a.verified_at) })),
    }, null, 2)],
  ];
  const manifest = JSON.stringify({
    schema: 1,
    generatedAt: now.toISOString(),
    document: { id: doc.id },
    files: files.map(([path, content]) => ({ path, sha256: sha(content), bytes: Buffer.byteLength(content, "utf8") })),
  }, null, 2);

  const zip = new JSZip();
  for (const [path, content] of [...files, ["manifest.json", manifest] as [string, string]]) {
    zip.file(path, content, { date: now, compression: "DEFLATE", createFolders: false });
  }
  const bytes = await zip.generateAsync({ type: "uint8array", platform: "UNIX" });
  const sha256 = sha(bytes);
  const path = `${userId}/${documentId}/evidence/${randomUUID()}.zip`;
  await blob.put(path, bytes);
  try {
    const { rows } = await pool.query("select register_evidence_pack($1, $2, $3, $4, $5, $6) as id", [userId, documentId, sha256, bytes.byteLength, path, now]);
    return { packId: rows[0].id, sha256, byteSize: bytes.byteLength };
  } catch (e) {
    // Pendaftaran gagal (mis. permintaan serentak ditolak): jangan tinggalkan berkas yatim di penyimpanan.
    await blob.delete(path).catch(() => undefined);
    return mapDbError(e);
  }
}

export async function downloadEvidencePack(deps: Deps, userId: string, packId: string): Promise<{ bytes: Uint8Array; filename: string } | null> {
  const { rows } = await deps.pool.query(
    `select e.sha256, e.storage_path, e.created_at, d.title from evidence_packs e join documents d on d.id = e.document_id
      where e.id = $1 and e.owner_id = $2`, [packId, userId]);
  const r = rows[0];
  if (!r) return null;
  const bytes = await deps.blob.get(r.storage_path);
  if (!bytes) throw new IntegrityError("BLOB_MISSING");
  if (sha(bytes) !== r.sha256) throw new IntegrityError("HASH_MISMATCH");
  const slug = String(r.title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "dokumen";
  return { bytes, filename: `bukti-${slug}-${(r.created_at as Date).toISOString().slice(0, 10)}.zip` };
}

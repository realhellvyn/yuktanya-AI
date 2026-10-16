import { randomUUID } from "node:crypto";
import type { BlobStore } from "@/lib/documents/blob";
import { sha256Hex } from "@/lib/documents/export";
import { canonicalize } from "@/lib/documents/render";
import { flags } from "@/lib/flags";
import type { PlanKey } from "@/lib/pricing/catalog";
import { titleFromFilename, uploadedDoc } from "./document";
import { UPLOAD_LIMITS } from "./limits";
import type { UploadCode } from "./messages";
import { extractUploadText } from "./parse";
import { triageText, type Triage } from "./triage";
import { detectUpload, type UploadKind } from "./validate";

export type SaveUploadInput = {
  userId: string; key: string; title: string; canonical: string; kind: UploadKind; filename: string; byteSize: number;
  originalSha256: string; path: string; pages: number | null; chars: number; risk: Triage; now: Date;
};
export type SaveUploadResult =
  | { status: "CREATED" | "DUPLICATE"; documentId: string; versionId: string; sha256: string }
  | { status: "QUOTA_DOCUMENT"; resetAt: string };

export type UploadDeps = {
  enabled?: () => boolean;
  getUserId: () => Promise<string | null>;
  plan: (userId: string, now: Date) => Promise<{ plan: PlanKey; documentsRemaining: number; resetAt?: string }>;
  blob: BlobStore;
  save: (input: SaveUploadInput) => Promise<SaveUploadResult>;
  // Pencatat event produk aman (tanpa isi). Opsional agar uji unit tanpa DB tetap sederhana.
  record?: (e: { name: string; actorUserId: string; entityType: string; entityId: string; dedupeKey: string; metadata: Record<string, string> }) => Promise<void>;
  now?: () => Date;
};
export type UploadResult =
  | { ok: true; documentId: string; versionId: string; risk: Triage; duplicate: boolean }
  | { ok: false; code: UploadCode; resetAt?: string };

const EXT: Record<UploadKind, string> = { PDF: "pdf", DOCX: "docx", TXT: "txt" };
const safeName = (n: string) => n.replace(/^.*[\\/]/, "").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 255) || "berkas";

// Unggah → validasi isi+ekstensi+ukuran → baca teks (terbatas) → triase → simpan berkas asli privat + versi beku.
// Tidak ada pemanggilan AI di sini; analisis dipicu terpisah setelah persetujuan eksplisit. Flag mati = tidak ada apa pun.
export async function handleUpload(deps: UploadDeps, input: { filename: string; bytes: Uint8Array; key: string; consentVersion?: string }): Promise<UploadResult> {
  if (!(deps.enabled ?? (() => flags.aiPreReview))()) return { ok: false, code: "FEATURE_DISABLED" };
  const userId = await deps.getUserId();
  if (!userId) return { ok: false, code: "AUTH_REQUIRED" };
  if (!/^[\x21-\x7e]{8,128}$/.test(input.key)) return { ok: false, code: "INTERNAL" };
  if (input.bytes.byteLength === 0 && !input.filename) return { ok: false, code: "NO_FILE" };
  const detected = detectUpload(input.filename, input.bytes);
  if (!detected.ok) return { ok: false, code: detected.code };

  const now = deps.now?.() ?? new Date();
  const entitlement = await deps.plan(userId, now);
  // Pemeriksaan cepat sebelum membaca/menyimpan; keputusan akhir tetap atomik di DB (create_upload).
  if (entitlement.documentsRemaining <= 0) return { ok: false, code: "DOCUMENT_DAILY_QUOTA_REACHED", resetAt: entitlement.resetAt };

  const parsed = await extractUploadText(detected.kind, input.bytes, UPLOAD_LIMITS[entitlement.plan]);
  if (!parsed.ok) return { ok: false, code: parsed.code };
  const risk = triageText(parsed.paragraphs);
  const title = titleFromFilename(input.filename);
  const canonical = canonicalize(uploadedDoc(title, parsed.paragraphs));
  const path = `${userId}/uploads/${randomUUID()}.${EXT[detected.kind]}`;
  await deps.blob.put(path, input.bytes);
  let saved: SaveUploadResult;
  try {
    saved = await deps.save({
      userId, key: input.key, title, canonical, kind: detected.kind, filename: safeName(input.filename), byteSize: input.bytes.byteLength,
      originalSha256: sha256Hex(input.bytes), path, pages: parsed.pages, chars: parsed.chars, risk, now,
    });
  } catch (e) {
    await deps.blob.delete(path).catch(() => undefined);
    throw e;
  }
  if (saved.status === "QUOTA_DOCUMENT") {
    await deps.blob.delete(path).catch(() => undefined);
    return { ok: false, code: "DOCUMENT_DAILY_QUOTA_REACHED", resetAt: saved.resetAt };
  }
  // Pengulangan dengan kunci sama: berkas yang baru ditulis tidak dipakai; versi lama yang dikembalikan.
  if (saved.status === "DUPLICATE") await deps.blob.delete(path).catch(() => undefined);
  // Persetujuan pengguna dicatat sebagai bukti: versi teks persetujuan + waktu, tanpa isi atau nama berkas.
  if (input.consentVersion && deps.record) {
    // Gagal mencatat SETELAH dokumen tersimpan: hasil jelas (bukan INTERNAL "belum tersimpan"); tidak ada yang dikirim ke AI.
    try {
      await deps.record({
        name: "document_upload_consent", actorUserId: userId, entityType: "document", entityId: saved.documentId,
        dedupeKey: `upload-consent:${userId}:${input.key}`, metadata: { consentVersion: input.consentVersion, kind: detected.kind, at: now.toISOString() },
      });
    } catch {
      return { ok: false, code: "CONSENT_NOT_RECORDED" };
    }
  }
  return { ok: true, documentId: saved.documentId, versionId: saved.versionId, risk, duplicate: saved.status === "DUPLICATE" };
}

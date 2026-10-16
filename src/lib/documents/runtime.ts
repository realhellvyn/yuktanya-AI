import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getPool } from "@/lib/db";
import { getSessionRoles } from "@/lib/supabase/server";
import { createFsBlobStore, createSupabaseBlobStore, type BlobStore } from "./blob";
import type { DocDeps } from "./handlers";
import { createPgDocumentsService, type DocumentsService } from "./service";

// Produksi memakai bucket privat Supabase bila tersedia; selain itu berkas lokal (pengembangan). Adapter Supabase belum diverifikasi.
function blobStore(): BlobStore {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (process.env.NODE_ENV === "production" && url && key) {
    return createSupabaseBlobStore(createClient(url, key, { auth: { persistSession: false } }), process.env.SUPABASE_STORAGE_BUCKET ?? "documents");
  }
  return createFsBlobStore(process.env.DOCUMENT_BLOB_DIR ?? ".data/blobs");
}

let cached: DocumentsService | undefined;
export const documentsService = (): DocumentsService => (cached ??= createPgDocumentsService(getPool(), process.env, { blob: blobStore() }));

export function documentsDeps(): DocDeps {
  return { getUserId: async () => (await getSessionRoles())?.userId ?? null, service: documentsService() };
}

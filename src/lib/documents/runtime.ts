import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getPool } from "@/lib/db";
import { getSessionRoles } from "@/lib/supabase/server";
import { chooseBlobMode, createFsBlobStore, createSupabaseBlobStore, type BlobStore } from "./blob";
import { homeFor } from "@/lib/auth/permissions";
import { ForbiddenError, type DocDeps } from "./handlers";
import { createPgDocumentsService, type DocumentsService } from "./service";

// Produksi memakai bucket privat Supabase bila tersedia; selain itu berkas lokal (pengembangan). Adapter Supabase belum diverifikasi.
function blobStore(): BlobStore {
  if (chooseBlobMode(process.env) === "supabase") {
    return createSupabaseBlobStore(
      createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } }),
      process.env.SUPABASE_STORAGE_BUCKET ?? "documents",
    );
  }
  return createFsBlobStore(process.env.DOCUMENT_BLOB_DIR ?? ".data/blobs");
}

let cached: DocumentsService | undefined;
export const documentsService = (): DocumentsService => (cached ??= createPgDocumentsService(getPool(), process.env, { blob: blobStore() }));

export function documentsDeps(): DocDeps {
  return {
    getUserId: async () => {
      const s = await getSessionRoles();
      if (!s) return null;
      if (homeFor(s.roles) !== "/dashboard") throw new ForbiddenError();
      return s.userId;
    },
    service: documentsService(),
  };
}

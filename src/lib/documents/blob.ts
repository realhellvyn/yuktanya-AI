import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface BlobStore {
  put(path: string, bytes: Uint8Array): Promise<void>;
  get(path: string): Promise<Uint8Array | null>;
}

// Path relatif tanpa segmen kosong, '.', '..', backslash, atau NUL; tidak boleh berawalan '/'.
export function assertSafePath(p: string): void {
  const bad =
    !p || p.startsWith("/") || p.includes("\\") || p.includes("\0") || p.split("/").some((s) => s === "" || s === "." || s === "..");
  if (bad) throw new Error("Invalid blob path");
}

export function createFsBlobStore(rootDir: string): BlobStore {
  const root = path.resolve(rootDir);
  const resolve = (p: string) => {
    assertSafePath(p);
    const target = path.resolve(root, p);
    if (!target.startsWith(root + path.sep)) throw new Error("Invalid blob path");
    return target;
  };
  return {
    async put(p, bytes) {
      const target = resolve(p);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, bytes, { flag: "wx" });
    },
    async get(p) {
      try {
        return new Uint8Array(await readFile(resolve(p)));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw e;
      }
    },
  };
}

// Adapter Supabase Storage (bucket privat). Belum dapat diuji di lingkungan tanpa Supabase; diverifikasi saat pilot.
export function createSupabaseBlobStore(client: SupabaseClient, bucket: string): BlobStore {
  return {
    async put(p, bytes) {
      assertSafePath(p);
      const { error } = await client.storage.from(bucket).upload(p, bytes, { contentType: "application/octet-stream", upsert: false });
      if (error) throw new Error(`Gagal menyimpan berkas: ${error.message}`);
    },
    async get(p) {
      assertSafePath(p);
      const { data, error } = await client.storage.from(bucket).download(p);
      if (error) {
        if (/not found|does not exist/i.test(error.message)) return null;
        throw new Error(`Gagal membaca berkas: ${error.message}`);
      }
      return new Uint8Array(await data.arrayBuffer());
    },
  };
}

// Produksi wajib memakai Supabase Storage; tanpa konfigurasi lengkap gagal keras, bukan diam-diam ke disk lokal yang tidak awet.
export function chooseBlobMode(env: { NODE_ENV?: string; NEXT_PUBLIC_SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string }): "supabase" | "fs" {
  if (env.NODE_ENV !== "production") return "fs";
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Produksi memerlukan konfigurasi Supabase Storage (NEXT_PUBLIC_SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY)");
  }
  return "supabase";
}

import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { parseCanonical, type RenderedDoc } from "@/lib/documents/render";
import { NotFoundError } from "@/lib/documents/service";
import { FeatureNotAvailableError } from "./features";

export class InvalidExpiryError extends Error {
  constructor() {
    super("INVALID_EXPIRY");
    this.name = "InvalidExpiryError";
  }
}

export type ShareView =
  | { status: "OK"; versionNo: number; sha256: string; title: string; doc: RenderedDoc; hasNewer: boolean }
  | { status: "EXPIRED" | "REVOKED" | "NOT_FOUND" };
export type ShareRow = { id: string; expiresAt: string; revokedAt: string | null; createdAt: string; openedCount: number };

export const hashToken = (token: string): string => createHash("sha256").update(token, "utf8").digest("hex");
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function mapShareError(e: unknown): never {
  const m = e instanceof Error ? e.message : "";
  if (m.includes("NOT_FOUND")) throw new NotFoundError();
  if (m.includes("FEATURE_NOT_AVAILABLE")) throw new FeatureNotAvailableError();
  if (m.includes("INVALID_EXPIRY")) throw new InvalidExpiryError();
  throw e;
}

export interface ShareService {
  create(userId: string, versionId: string, ttlSeconds: number, now?: Date): Promise<{ shareId: string; token: string }>;
  list(userId: string, versionId: string): Promise<ShareRow[]>;
  revoke(userId: string, shareId: string, now?: Date): Promise<void>;
  resolve(token: string, now?: Date): Promise<ShareView>;
}

export function createPgShareService(pool: Pool): ShareService {
  return {
    async create(userId, versionId, ttlSeconds, now = new Date()) {
      const token = randomBytes(32).toString("base64url");
      const expires = new Date(now.getTime() + ttlSeconds * 1000);
      try {
        const { rows } = await pool.query("select create_share($1, $2, $3, $4, $5) as id", [userId, versionId, hashToken(token), expires, now]);
        return { shareId: rows[0].id, token };
      } catch (e) {
        return mapShareError(e);
      }
    },

    async list(userId, versionId) {
      const { rows } = await pool.query("select * from list_shares($1, $2)", [userId, versionId]);
      return rows.map((r) => ({
        id: r.id, expiresAt: r.expires_at.toISOString(), revokedAt: r.revoked_at ? r.revoked_at.toISOString() : null,
        createdAt: r.created_at.toISOString(), openedCount: Number(r.opened_count),
      }));
    },

    async revoke(userId, shareId, now = new Date()) {
      try {
        await pool.query("select revoke_share($1, $2, $3)", [userId, shareId, now]);
      } catch (e) {
        mapShareError(e);
      }
    },

    async resolve(token, now = new Date()) {
      if (!TOKEN.test(token)) return { status: "NOT_FOUND" };
      const { rows } = await pool.query("select * from resolve_share($1, $2)", [hashToken(token), now]);
      const r = rows[0];
      if (r.status !== "OK") return { status: r.status };
      return { status: "OK", versionNo: r.version_no, sha256: r.sha256, title: r.title, doc: parseCanonical(r.canonical_text), hasNewer: r.has_newer };
    },
  };
}

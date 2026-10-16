import { createHash, randomBytes, randomInt } from "node:crypto";
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

export class TooManySharesError extends Error {
  constructor() {
    super("TOO_MANY_SHARES");
    this.name = "TooManySharesError";
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
  if (m.includes("TOO_MANY_SHARES")) throw new TooManySharesError();
  throw e;
}

export type AckRequestResult = "SENT" | "RATE_LIMITED" | "NOT_FOUND";
export type AckVerifyResult = "VERIFIED" | "INVALID" | "EXPIRED" | "LOCKED" | "NOT_FOUND";
export type AckRow = { shareId: string; email: string; verifiedAt: string };

export class InvalidEmailError extends Error {
  constructor() {
    super("Alamat email tidak valid");
    this.name = "InvalidEmailError";
  }
}

const normalizeEmail = (raw: string): string => {
  const e = raw.trim().toLowerCase();
  if (e.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new InvalidEmailError();
  return e;
};

export interface ShareService {
  create(userId: string, versionId: string, ttlSeconds: number, now?: Date): Promise<{ shareId: string; token: string }>;
  list(userId: string, versionId: string): Promise<ShareRow[]>;
  revoke(userId: string, shareId: string, now?: Date): Promise<void>;
  resolve(token: string, now?: Date): Promise<ShareView>;
  requestAck(token: string, email: string, now?: Date): Promise<AckRequestResult>;
  verifyAck(token: string, email: string, code: string, now?: Date): Promise<AckVerifyResult>;
  acknowledgements(userId: string, versionId: string): Promise<AckRow[]>;
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

    async requestAck(token, email, now = new Date()) {
      const to = normalizeEmail(email);
      if (!TOKEN.test(token)) return "NOT_FOUND";
      const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
      const { rows } = await pool.query("select request_ack($1, $2, $3, $4) as r", [hashToken(token), to, code, now]);
      return rows[0].r as AckRequestResult;
    },

    async verifyAck(token, email, code, now = new Date()) {
      const to = normalizeEmail(email);
      if (!TOKEN.test(token)) return "NOT_FOUND";
      if (!/^\d{6}$/.test(code)) return "INVALID";
      const { rows } = await pool.query("select verify_ack($1, $2, $3, $4) as r", [hashToken(token), to, code, now]);
      return rows[0].r as AckVerifyResult;
    },

    async acknowledgements(userId, versionId) {
      const { rows } = await pool.query("select * from list_acknowledgements($1, $2)", [userId, versionId]);
      return rows.map((r) => ({ shareId: r.share_id, email: r.email, verifiedAt: r.verified_at.toISOString() }));
    },
  };
}

import type { Pool } from "pg";

export type VaultFeature = "vault.share" | "vault.reminders" | "vault.evidence_pack";

export class FeatureNotAvailableError extends Error {
  constructor() {
    super("FEATURE_NOT_AVAILABLE");
    this.name = "FeatureNotAvailableError";
  }
}

export async function hasFeature(pool: Pool, userId: string, key: VaultFeature, now: Date = new Date()): Promise<boolean> {
  const { rows } = await pool.query("select has_feature($1, $2, $3) as ok", [userId, key, now]);
  return rows[0].ok as boolean;
}

import "server-only";
import { getPool } from "@/lib/db";
import { createPgRateLimiter, type RateLimiter, type RateScope } from "./rate-limit";

// Pembatas laju bersama (DB) per cakupan; dibuat sekali per proses, keadaan ada di database.
const cache = new Map<RateScope, RateLimiter>();
export function rateLimiter(scope: RateScope): RateLimiter {
  let l = cache.get(scope);
  if (!l) cache.set(scope, (l = createPgRateLimiter(getPool(), scope)));
  return l;
}

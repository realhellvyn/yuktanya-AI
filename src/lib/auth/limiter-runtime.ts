import "server-only";
import { getPool } from "@/lib/db";
import { createPgAuthLimiter, type AuthLimiter } from "./rate-limit";

let limiter: AuthLimiter | undefined;
export const authLimiter = (): AuthLimiter => (limiter ??= createPgAuthLimiter(getPool()));

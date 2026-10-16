import "server-only";
import { getPool } from "@/lib/db";
import { createPgVerificationService, type VerificationService } from "./service";

let cached: VerificationService | undefined;
export const verificationService = (): VerificationService => (cached ??= createPgVerificationService(getPool()));

import "server-only";
import { getPool } from "@/lib/db";
import { createPgCasesService, type CasesService } from "./service";

let cached: CasesService | undefined;
export const casesService = (): CasesService => (cached ??= createPgCasesService(getPool()));

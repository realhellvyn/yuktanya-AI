import "server-only";
import { getPool } from "@/lib/db";
import { createPgPartnerService, type PartnerService } from "./service";

let cached: PartnerService | undefined;
export const partnerService = (): PartnerService => (cached ??= createPgPartnerService(getPool()));

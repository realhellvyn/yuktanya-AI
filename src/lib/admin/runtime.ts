import "server-only";
import { getPool } from "@/lib/db";
import { createPgAdminService, type AdminService } from "./service";

let cached: AdminService | undefined;
export const adminService = (): AdminService => (cached ??= createPgAdminService(getPool()));

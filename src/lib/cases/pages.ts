// Pemuat data halaman Kasus Hukum Khusus. Kepemilikan/peran diperiksa di fungsi DB; id tidak valid = 404 yang identik.
import type { CasesService, OwnerCase, PartnerCase } from "./service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string | null | undefined): s is string => typeof s === "string" && UUID.test(s);

export async function loadOwnerCasePage(service: CasesService, userId: string, caseId: string): Promise<{ kind: "notFound" } | { kind: "ok"; c: OwnerCase }> {
  if (!isUuid(caseId)) return { kind: "notFound" };
  const c = await service.getForOwner(userId, caseId);
  return c ? { kind: "ok", c } : { kind: "notFound" };
}

export async function loadPartnerCasePage(service: CasesService, actorId: string, caseId: string): Promise<{ kind: "notFound" } | { kind: "ok"; c: PartnerCase }> {
  if (!isUuid(caseId)) return { kind: "notFound" };
  const c = await service.partnerGet(actorId, caseId);
  return c ? { kind: "ok", c } : { kind: "notFound" };
}

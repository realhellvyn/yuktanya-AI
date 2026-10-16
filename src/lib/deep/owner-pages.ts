// Pemuat data halaman Deep Review sisi pemilik. Kepemilikan diperiksa di sini (dan di fungsi DB), bukan di UI.
import type { DeepService, Eligibility, OwnerDeep } from "./service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type OfferPage =
  | { kind: "notFound" }
  | { kind: "redirect"; to: string }
  | { kind: "ineligible"; eligibility: Eligibility }
  | { kind: "offer"; eligibility: Eligibility };

// Flag mati, bukan pemilik, atau id tidak dikenal: semuanya notFound yang identik.
export async function loadDeepOfferPage(deps: { service: DeepService; flag: boolean }, userId: string, reviewId: string): Promise<OfferPage> {
  if (!deps.flag || !UUID.test(reviewId)) return { kind: "notFound" };
  const eligibility = await deps.service.eligibility(userId, reviewId);
  if (eligibility.reason === "NOT_FOUND") return { kind: "notFound" };
  const existing = await deps.service.forParent(userId, reviewId);
  if (existing) return { kind: "redirect", to: `/deep-reviews/${existing.deepId}` };
  return eligibility.eligible && eligibility.quote ? { kind: "offer", eligibility } : { kind: "ineligible", eligibility };
}

export type StatusPage = { kind: "notFound" } | { kind: "ok"; deep: OwnerDeep; assigned: boolean };

// Pemilik yang sudah membayar tetap bisa melihat statusnya walau flag pembelian dimatikan.
export async function loadDeepStatusPage(service: DeepService, userId: string, deepId: string): Promise<StatusPage> {
  if (!UUID.test(deepId)) return { kind: "notFound" };
  const deep = await service.getForOwner(userId, deepId);
  if (!deep) return { kind: "notFound" };
  return { kind: "ok", deep, assigned: await service.isAssigned(userId, deepId) };
}

import "server-only";
import { trackEvent } from "@/lib/analytics/events";
import { getPool } from "@/lib/db";

// Paparan penawaran Pemeriksaan Mendalam: satu event per review induk (penawaran berbeda yang tampil), hanya ID.
export const trackDeepOfferShown = (userId: string, reviewId: string) =>
  trackEvent(getPool(), { name: "deep_offer_shown", actorUserId: userId, entityType: "review_request", entityId: reviewId, dedupeKey: `deep_offer_shown:${reviewId}` });

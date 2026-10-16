import { notFound, redirect } from "next/navigation";
import { DeepOffer } from "@/components/deep/deep-offer";
import { Card, PageHeading } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { deepService } from "@/lib/deep/runtime";
import { trackDeepOfferShown } from "@/lib/deep/offer-event";
import { loadDeepOfferPage } from "@/lib/deep/owner-pages";
import { flags } from "@/lib/flags";
import { requireUserId } from "@/lib/documents/session";
import { reviewService } from "@/lib/reviews/runtime";
import { requestDeepAction } from "../../../checkout/actions";

export const dynamic = "force-dynamic";
const REASON: Record<string, string> = {
  PARENT_NOT_COMPLETED: "Pemeriksaan standar belum selesai.",
  NO_ACTIONABLE_NOTES: "Pemeriksaan standar tidak memiliki catatan yang perlu ditindaklanjuti, jadi pemeriksaan mendalam tidak ditawarkan.",
  PARENT_NOT_ACTIVE: "Verifikasi pemeriksaan standar sudah tidak aktif.",
  VERSION_MISMATCH: "Isi versi tidak cocok dengan versi yang diperiksa.",
  DEEP_EXISTS: "Pemeriksaan mendalam untuk pemeriksaan ini sudah dipesan atau selesai.",
};

export default async function DeepOfferPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string }> }) {
  const { id } = await params;
  const q = await searchParams;
  const userId = await requireUserId();
  const page = await loadDeepOfferPage({ service: deepService(), flag: flags.deepReviewPurchase, track: trackDeepOfferShown }, userId, id);
  if (page.kind === "notFound") notFound();
  if (page.kind === "redirect") redirect(page.to);
  const review = await reviewService().getForOwner(userId, id);
  if (!review) notFound();
  return (
    <main className="max-w-3xl space-y-6">
      <PageHeading title="Pemeriksaan mendalam" lead={`Untuk ${review.title}, versi ${review.versionNo}`} />
      {q.notice && <p role="alert" className="font-semibold text-red-800">Pemeriksaan mendalam belum dapat dipesan ({q.notice}).</p>}
      {page.kind === "offer" ? (
        <DeepOffer eligible reason={page.eligibility.reason} quote={page.eligibility.quote} action={requestDeepAction} parentRequestId={id} />
      ) : (
        <Card className="space-y-2">
          <h2 className="text-xl font-semibold">Belum dapat ditawarkan</h2>
          <p role="status">{REASON[page.eligibility.reason] ?? "Pemeriksaan mendalam belum tersedia untuk pemeriksaan ini."}</p>
        </Card>
      )}
      <ButtonLink href={`/reviews/${id}`} variant="secondary">Kembali ke hasil pemeriksaan</ButtonLink>
    </main>
  );
}

import { notFound } from "next/navigation";
import { ButtonLink } from "@/components/ui/button";
import { ReviewTimeline } from "@/components/reviews/review-timeline";
import { ResultPanel } from "@/components/reviews/result-panel";
import { DeepOffer } from "@/components/deep/deep-offer";
import { DeepResult } from "@/components/deep/deep-result";
import { deepNoticeText } from "@/lib/deep/notices";
import { trackDeepOfferShown } from "@/lib/deep/offer-event";
import { offerViewProps } from "@/lib/deep/owner-pages";
import { deepService } from "@/lib/deep/runtime";
import { flags } from "@/lib/flags";
import { getPool } from "@/lib/db";
import { requestDeepAction } from "../../checkout/actions";
import { requireUserId } from "@/lib/documents/session";
import { reviewService } from "@/lib/reviews/runtime";
import { qrPng, verifyUrl } from "@/lib/verification/qr";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ReviewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string }> }) {
  const q = await searchParams;
  const notice = deepNoticeText(q.notice);
  const { id } = await params;
  const userId = await requireUserId();
  if (!UUID.test(id)) notFound();
  const review = await reviewService().getForOwner(userId, id);
  if (!review) notFound();
  const latest = (await getPool().query("select max(version_no) as n from document_versions where document_id = (select document_id from document_versions where id = $1)", [review.versionId])).rows[0].n;
  let url: string | undefined;
  let qr: string | undefined;
  if (review.verification && review.verification.status !== "REVOKED") {
    url = verifyUrl(review.verification.code);
    qr = `data:image/png;base64,${Buffer.from(await qrPng(url)).toString("base64")}`;
  } else if (review.verification) {
    url = verifyUrl(review.verification.code);
  }
  const deepRef = await deepService().forParent(userId, id);
  const deep = deepRef ? await deepService().getForOwner(userId, deepRef.deepId) : null;
  let deepUrl: string | undefined;
  if (deep?.verification) deepUrl = verifyUrl(deep.verification.code);
  const elig = flags.deepReviewPurchase && !deep && review.status === "COMPLETED" && review.outcome === "WITH_NOTES" ? await deepService().eligibility(userId, id) : null;
  if (elig?.eligible) await trackDeepOfferShown(userId, id);
  return (
    <main className="max-w-3xl space-y-6">
      <h1 className="text-[1.75rem] font-bold leading-tight tracking-tight text-navy md:text-4xl">{review.title} — versi {review.versionNo}</h1>
      <ReviewTimeline status={review.status} />
      <ResultPanel review={review} verifyUrl={url} qrDataUrl={qr} isLatestVersion={review.versionNo === latest} />
      {notice && <p role="alert" className="font-semibold text-red-800">{notice}</p>}
      {deep && <DeepResult deep={deep} verifyUrl={deepUrl} />}
      {deepRef && <ButtonLink href={`/deep-reviews/${deepRef.deepId}`} variant="secondary">Lihat status pemeriksaan mendalam</ButtonLink>}
      {elig?.eligible && <ButtonLink href={`/reviews/${id}/deep`} variant="secondary">Lihat rincian pemeriksaan mendalam</ButtonLink>}
      {elig && <DeepOffer {...offerViewProps(elig)} action={requestDeepAction} parentRequestId={id} />}
    </main>
  );
}

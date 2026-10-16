import { notFound } from "next/navigation";
import { ReviewTimeline } from "@/components/reviews/review-timeline";
import { ResultPanel } from "@/components/reviews/result-panel";
import { getPool } from "@/lib/db";
import { requireUserId } from "@/lib/documents/session";
import { reviewService } from "@/lib/reviews/runtime";
import { qrPng, verifyUrl } from "@/lib/verification/qr";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
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
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-3xl font-semibold">{review.title} — versi {review.versionNo}</h1>
      <ReviewTimeline status={review.status} />
      <ResultPanel review={review} verifyUrl={url} qrDataUrl={qr} isLatestVersion={review.versionNo === latest} />
    </main>
  );
}

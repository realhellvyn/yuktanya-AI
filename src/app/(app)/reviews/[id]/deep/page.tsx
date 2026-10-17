import { notFound, redirect } from "next/navigation";
import { DeepOffer } from "@/components/deep/deep-offer";
import { Card, PageHeading } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { deepService } from "@/lib/deep/runtime";
import { trackDeepOfferShown } from "@/lib/deep/offer-event";
import { loadDeepOfferPage, offerViewProps } from "@/lib/deep/owner-pages";
import { flags } from "@/lib/flags";
import { deepNoticeText } from "@/lib/deep/notices";
import { fixedText } from "@/lib/query-text";
import { requireUserId } from "@/lib/documents/session";
import { reviewService } from "@/lib/reviews/runtime";
import { requestDeepAction } from "../../../checkout/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Deep Review | Yuktanya" };
const REASON: Record<string, string> = {
  PARENT_NOT_COMPLETED: "Legal Review belum selesai.",
  NO_ACTIONABLE_NOTES: "Legal Review ini tidak memuat Legal Note yang perlu ditindaklanjuti, sehingga Deep Review tidak ditawarkan.",
  PARENT_NOT_ACTIVE: "Verifikasi Legal Review sudah tidak aktif.",
  VERSION_MISMATCH: "Isi versi tidak cocok dengan versi yang diperiksa.",
  DEEP_EXISTS: "Deep Review untuk Legal Review ini sudah dipesan atau sudah selesai.",
  SPECIAL_CASE_OPEN: "Dokumen ini sedang ditangani sebagai Kasus Hukum Khusus (Special Legal Case), sehingga Deep Review tidak ditawarkan.",
};

export default async function DeepOfferPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string }> }) {
  const { id } = await params;
  // Kode dari alamat → kalimat tetap; kode tidak dikenal tidak menampilkan apa pun (D-05).
  const notice = deepNoticeText((await searchParams).notice);
  const userId = await requireUserId();
  const page = await loadDeepOfferPage({ service: deepService(), flag: flags.deepReviewPurchase, track: trackDeepOfferShown }, userId, id);
  if (page.kind === "notFound") notFound();
  if (page.kind === "redirect") redirect(page.to);
  const review = await reviewService().getForOwner(userId, id);
  if (!review) notFound();
  const rubricApproved = page.kind === "offer" ? await deepService().rubricApproved() : true;
  return (
    <main className="max-w-3xl space-y-6">
      <PageHeading title="Deep Review" lead={`Untuk ${review.title}, versi ${review.versionNo}`} />
      {notice && <p role="alert" className="font-semibold text-red-800">{notice}</p>}
      {page.kind === "offer" ? (
        <DeepOffer {...offerViewProps(page.eligibility)} rubricApproved={rubricApproved} action={requestDeepAction} parentRequestId={id} />
      ) : (
        <Card className="space-y-2">
          <h2 className="text-xl font-semibold">Deep Review belum dapat ditawarkan</h2>
          <p role="status">{fixedText(REASON, page.eligibility.reason) ?? "Deep Review belum tersedia untuk Legal Review ini."}</p>
        </Card>
      )}
      <ButtonLink href={`/reviews/${id}`} variant="secondary">Kembali ke hasil Legal Review</ButtonLink>
    </main>
  );
}

import { listOwnerReviewsHandler } from "@/lib/reviews/handlers";
import { reviewDeps } from "@/lib/reviews/runtime";

export const GET = (req: Request) => listOwnerReviewsHandler(reviewDeps(), req);

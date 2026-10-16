import { handleAiReview } from "@/lib/ai/prereview";
import { aiReviewDeps } from "@/lib/vault/runtime";

export const POST = async (req: Request, ctx: { params: Promise<{ versionId: string }> }) => handleAiReview(aiReviewDeps(), req, await ctx.params);

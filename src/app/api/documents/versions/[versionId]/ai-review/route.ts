import { handleAiReview } from "@/lib/ai/prereview";
import { aiReviewDeps } from "@/lib/vault/runtime";

// Task 24 (A04): fungsi tidak boleh dipotong sebelum tenggat giliran AI 75 detik (+ baca berkas/DB); harus literal untuk Next.
export const maxDuration = 120;
export const POST = async (req: Request, ctx: { params: Promise<{ versionId: string }> }) => handleAiReview(aiReviewDeps(), req, await ctx.params);

// Giliran percakapan pembuatan dokumen. userId hanya dari sesi; tidak pernah dari klien.
import { handleChatTurn } from "@/lib/ai/chat-turn";
import { chatTurnDeps } from "@/lib/vault/runtime";

// Task 24 (A04): fungsi tidak boleh dipotong sebelum tenggat giliran AI 75 detik (+ baca berkas/DB); harus literal untuk Next.
export const maxDuration = 120;
export const POST = async (req: Request, ctx: { params: Promise<{ id: string }> }) => handleChatTurn(chatTurnDeps(), req, await ctx.params);

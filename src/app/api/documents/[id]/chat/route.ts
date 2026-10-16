// Giliran percakapan pembuatan dokumen. userId hanya dari sesi; tidak pernah dari klien.
import { handleChatTurn } from "@/lib/ai/chat-turn";
import { chatTurnDeps } from "@/lib/vault/runtime";

export const POST = async (req: Request, ctx: { params: Promise<{ id: string }> }) => handleChatTurn(chatTurnDeps(), req, await ctx.params);
